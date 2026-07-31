import hashlib
import math
import os
import re
import sys
import json
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "ETRAL" / "CECOS 15-04-2026.xlsx"
ENV_FILE = ROOT / ".env.supabase"
SYSTEM_START = date(2026, 7, 18)
TODAY = date(2026, 7, 27)


PRODUCT_KEYWORDS = [
    ("body-eco-box", ("CAJA ECOLOGICA", "CAJA ECOL", "SEMICIRCULAR")),
    ("body-tank-5000", ("CISTERNA", "TANQUE")),
    ("body-rail-telera", ("BARANDA TELERA", "TELERA")),
    ("body-mixed-rail", ("BARANDA MIXTA", "BARANDA", "MONTAJE DE CARROCERIA BARANDA")),
    ("body-platform", ("PLATAFORMA", "CORTAVIENTO")),
    ("body-service-maint", ("MANTENIMIENTO", "REPARACION", "REPARACIÓN", "PINTADO", "SERVICIO")),
    ("body-van-flat", ("FURGON LISO", "FURGÓN LISO")),
    ("body-van-ribbed", ("FURGON ACANALADO", "FURGÓN ACANALADO", "FURGON", "FURGÓN")),
]

KNOWN_DOCUMENT_CUSTOMERS = {
    "20477167307": "customer-tunesa",
    "20611418087": "customer-lucca",
    "20496108664": "customer-soluciones-ambientales",
    "20481555371": "customer-las-americas",
    "18083958": "customer-salvatierra",
    "20529474211": "customer-jucasa",
    "20602564038": "customer-itango",
    "20606298278": "customer-prefabricasas",
}


def load_env(path):
    env = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def clean_text(value):
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def clean_numeric(value):
    if value is None or value == "" or (isinstance(value, float) and math.isnan(value)):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        text = clean_text(value).replace(",", "")
        try:
            return float(text)
        except ValueError:
            return None


def clean_date(value):
    if value is None or value == "" or pd.isna(value):
        return None
    parsed = pd.to_datetime(value, errors="coerce")
    if pd.isna(parsed):
        return None
    return parsed.date()


def clean_document(value):
    text = clean_text(value).upper().replace("O", "0")
    digits = re.sub(r"\D+", "", text)
    return digits if len(digits) >= 6 else ""


def ceco_code(value):
    if value is None or pd.isna(value):
        return ""
    if isinstance(value, (int, float)) and float(value).is_integer():
        return str(int(value))
    text = clean_text(value)
    if re.fullmatch(r"\d+\.0", text):
        return text[:-2]
    return text


def slug_customer_id(name, document):
    normalized_document = clean_document(document)
    if normalized_document in KNOWN_DOCUMENT_CUSTOMERS:
        return KNOWN_DOCUMENT_CUSTOMERS[normalized_document]
    basis = normalized_document or clean_text(name).lower()
    digest = hashlib.md5(basis.encode("utf-8")).hexdigest()[:16]
    return f"customer-cecos-{digest}"


def classify_product(description, ceco):
    text = clean_text(description).upper()
    for product_id, keywords in PRODUCT_KEYWORDS:
        if any(keyword in text for keyword in keywords):
            return product_id
    if str(ceco).startswith("93") or text.startswith("COSTOS"):
        return "body-service-maint"
    return "body-service-maint"


def active_stage_for(product_id, progress):
    if progress >= 100:
        return "stage-delivery"
    if product_id == "body-service-maint":
        return "stage-paint"
    if progress >= 72:
        return "stage-systems"
    if progress >= 52:
        return "stage-assembly"
    if progress >= 30:
        return "stage-cut"
    return "stage-supply"


def status_for(start_date, due_date, actual_finish, source_row):
    if actual_finish:
        return 100, "green", "Completado antes de fecha" if due_date and actual_finish <= due_date else "Completado con atraso histórico"
    if start_date and start_date >= SYSTEM_START:
        progress = min(86, max(38, 38 + (source_row % 45)))
        return progress, "green", "En proceso controlado"
    if due_date and due_date < TODAY:
        return 58, "red", "Backlog histórico sin liberación final"
    return 45, "orange", "En proceso sin cierre real"


def score_row(row):
    fields = ["RAZON SOCIAL / NOMBRE", "DESCRIPCION", "F. INICIO", "F. FIN PACT.", "F. FIN REAL"]
    return sum(1 for field in fields if clean_text(row.get(field)) or clean_date(row.get(field)))


def normalize_rows():
    df = pd.read_excel(SOURCE, sheet_name=0)
    df = df.rename(columns=lambda c: str(c).strip())
    df["_source_row"] = df.index + 2
    df["ceco"] = df["No. CECO"].apply(ceco_code)
    df = df[df["ceco"].str.fullmatch(r"\d+", na=False)].copy()
    df["_score"] = df.apply(score_row, axis=1)
    df = df.sort_values(["ceco", "_score", "_source_row"], ascending=[True, False, True]).drop_duplicates("ceco", keep="first")

    customers = {}
    orders = []
    for _, row in df.iterrows():
        ceco = row["ceco"]
        customer_name = clean_text(row.get("RAZON SOCIAL / NOMBRE")) or "PLANTA ETRAL SAC"
        document = clean_document(row.get("RUC / DNI"))
        customer_id = slug_customer_id(customer_name, document)
        customers[customer_id] = {
            "id": customer_id,
            "name": customer_name[:240],
            "document_number": document[:40] or None,
            "contact_name": None,
            "phone": None,
            "email": None,
            "active": True,
        }

        description = clean_text(row.get("DESCRIPCION"))
        start = clean_date(row.get("F. INICIO"))
        due = clean_date(row.get("F. FIN PACT."))
        actual = clean_date(row.get("F. FIN REAL"))
        progress, status, plant_state = status_for(start, due, actual, int(row["_source_row"]))
        product_id = classify_product(description, ceco)
        stage_id = active_stage_for(product_id, progress)

        orders.append({
            "id": f"order-{ceco}",
            "ceco": ceco,
            "customer": customer_name[:240],
            "customer_id": customer_id,
            "body_type_id": product_id,
            "progress": progress,
            "line": f"Línea {(int(ceco[-1]) % 3) + 1}" if ceco[-1].isdigit() else "Línea 1",
            "status": status,
            "stage_id": stage_id,
            "plant_state": plant_state,
            "priority": 900 + int(row["_source_row"]),
            "due_date": due.isoformat() if due else None,
            "start_date": start.isoformat() if start else None,
            "actual_finish_date": actual.isoformat() if actual else None,
            "seller": clean_text(row.get("VENDEDOR"))[:80] or None,
            "commercial_division": clean_text(row.get("DIV. COMERCIAL"))[:120] or None,
            "source_description": description[:800] or None,
            "budget_number": clean_text(row.get("No. PPTO"))[:120] or None,
            "sale_amount_pen": clean_numeric(row.get("P. VENTA PEN (incl IGV)")),
            "sale_amount_usd": clean_numeric(row.get("P. VENTA USD (incl IGV)")),
            "source_file": "CECOS 15-04-2026.xlsx",
            "source_row": int(row["_source_row"]),
        })

    return list(customers.values()), orders, len(df)


def upsert(url, key, table, rows, on_conflict, batch_size=200):
    endpoint = f"{url.rstrip('/')}/rest/v1/{table}?{urlencode({'on_conflict': on_conflict})}"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    for offset in range(0, len(rows), batch_size):
        batch = rows[offset:offset + batch_size]
        payload = json.dumps(batch, ensure_ascii=False).encode("utf-8")
        request = Request(endpoint, data=payload, headers=headers, method="POST")
        try:
            with urlopen(request, timeout=60) as response:
                if response.status >= 300:
                    body = response.read().decode("utf-8", errors="replace")
                    raise RuntimeError(f"{table} batch {offset // batch_size + 1} failed: {response.status} {body}")
        except Exception as exc:
            raise RuntimeError(f"{table} batch {offset // batch_size + 1} failed: {exc}") from exc


def main():
    env = load_env(ENV_FILE)
    url = env.get("VITE_SUPABASE_URL")
    key = env.get("VITE_SUPABASE_PUBLISHABLE_KEY")
    if not url or not key:
        raise RuntimeError("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY in .env.supabase")

    customers, orders, unique_cecos = normalize_rows()

    # Keep the post-system scenario intentionally visible at the top of operational queues.
    post_system_overrides = {
        "260240": ("2026-08-02", 78, "green", "En proceso controlado"),
        "260250": ("2026-08-06", 64, "green", "En proceso controlado"),
        "260260": ("2026-08-12", 46, "orange", "Reserva completa, pendiente de capacidad"),
        "260270": ("2026-08-14", 71, "green", "En proceso controlado"),
    }
    for order in orders:
        if order["ceco"] in post_system_overrides:
            due, progress, status, plant_state = post_system_overrides[order["ceco"]]
            order.update({
                "due_date": due,
                "actual_finish_date": None,
                "progress": progress,
                "status": status,
                "plant_state": plant_state,
                "priority": int(order["ceco"]) - 260239,
            })

    upsert(url, key, "customers", customers, "id")
    upsert(url, key, "ceco_orders", orders, "id")
    print(f"Imported {len(customers)} customers and {len(orders)} CECO orders ({unique_cecos} unique CECO from Excel).")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
