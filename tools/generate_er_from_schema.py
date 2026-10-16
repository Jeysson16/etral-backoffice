"""Create a Mermaid ER diagram from a Supabase SQL schema export.

The input is read as context only. No SQL is executed.
"""

import argparse
import re
from pathlib import Path


TABLE_RE = re.compile(r"CREATE TABLE\s+(?:public\.)?(\w+)\s*\((.*?)\n\);", re.I | re.S)
FK_RE = re.compile(
    r"FOREIGN KEY\s*\((\w+)\)\s*REFERENCES\s+(?:(\w+)\.)?(\w+)\s*\((\w+)\)",
    re.I,
)
PK_RE = re.compile(r"PRIMARY KEY\s*\(([^)]+)\)", re.I)
UNIQUE_RE = re.compile(r"\bUNIQUE\s*\(([^)]+)\)", re.I)


def columns(body):
    result = {}
    for line in body.splitlines():
        match = re.match(r"\s*(\w+)\s+(text|uuid|bigint|integer|numeric|boolean|date|jsonb|timestamp with time zone|time without time zone)\b(.*)", line, re.I)
        if match:
            name, kind, tail = match.groups()
            result[name] = {
                "type": {"timestamp with time zone": "timestamptz", "time without time zone": "time", "integer": "int"}.get(kind.lower(), kind.lower()),
                "nullable": not bool(re.search(r"\bNOT NULL\b", tail, re.I)),
                "unique": bool(re.search(r"\bUNIQUE\b", tail, re.I)),
            }
    return result


def make_diagram(sql):
    tables = {name: body for name, body in TABLE_RE.findall(sql)}
    if not tables:
        raise ValueError("No se encontraron bloques CREATE TABLE en el esquema.")
    lines = [
        "# Diagrama de entidad relación de ETRAL",
        "",
        "Generado a partir del esquema SQL entregado para revisión. Muestra las claves primarias, únicas y foráneas y todas las relaciones declaradas con `FOREIGN KEY`; omite atributos no clave para mantener legible el diagrama. Las relaciones con `auth.users` pertenecen al esquema de autenticación de Supabase.",
        "",
        "```mermaid",
        '%%{init: {"theme": "base", "look": "classic", "er": {"stroke": "#000000", "fill": "transparent"}, "themeVariables": {"background": "transparent", "primaryColor": "#ffffff", "primaryTextColor": "#000000", "secondaryTextColor": "#000000", "tertiaryTextColor": "#000000", "primaryBorderColor": "#000000", "lineColor": "#000000", "textColor": "#000000", "edgeLabelBackground": "transparent"}}}%%',
        "erDiagram",
    ]
    relationships = []
    for table, body in tables.items():
        col = columns(body)
        pk_match = PK_RE.search(body)
        pk = {item.strip() for item in pk_match.group(1).split(",")} if pk_match else set()
        unique_columns = {name for name, info in col.items() if info["unique"]}
        for fields in UNIQUE_RE.findall(body):
            names = [name.strip() for name in fields.split(",")]
            if len(names) == 1:
                unique_columns.add(names[0])
        if len(pk) == 1:
            unique_columns.update(pk)
        fks = FK_RE.findall(body)
        fk_names = {item[0] for item in fks}
        lines.append(f"  {table.upper()} {{")
        for name, info in col.items():
            if name not in pk and name not in fk_names and not info["unique"]:
                continue
            tags = [tag for tag, test in (("PK", name in pk), ("FK", name in fk_names), ("UK", info["unique"])) if test]
            lines.append(f"    {info['type']} {name} {','.join(tags)}")
        lines.append("  }")
        for child_col, schema, parent, parent_col in fks:
            parent_name = parent.upper() if not schema or schema.lower() == "public" else f"{schema}_{parent}".upper()
            nullable = col[child_col]["nullable"]
            ratio = "1:1" if child_col in unique_columns else "1:N"
            parent_end = "o|" if nullable else "||"
            child_end = "o|" if ratio == "1:1" else "o{"
            relationships.append((parent_name, table.upper(), parent_end, child_end, child_col, parent_col, ratio, nullable))
    if any(parent == "AUTH_USERS" for parent, *_ in relationships):
        lines.extend(["  AUTH_USERS {", "    uuid id PK", "  }"])
    lines.append("")
    for parent, child, parent_end, child_end, child_col, _parent_col, ratio, _nullable in relationships:
        lines.append(f"  {parent} {parent_end}--{child_end} {child} : \"{ratio} por {child_col}\"")
    one_to_one = sum(item[6] == "1:1" for item in relationships)
    one_to_many = len(relationships) - one_to_one
    lines.extend([
        "```",
        "",
        f"**Alcance:** {len(tables)} tablas de `public` y {len(relationships)} claves foráneas declaradas. `simulation_runs` está definida en el esquema, pero la interfaz actual no guarda sus corridas allí.",
        "",
        f"**Tipos físicos presentes:** {one_to_many} relaciones `1:N` y {one_to_one} relaciones `1:1`. Una relación `1:N` se lee `N:1` desde la tabla hija hacia la padre. Una clave foránea única en la hija produciría `1:1`.",
        "",
        "**Lectura de mínimos:** `||` junto a la tabla padre significa que cada fila hija requiere exactamente un padre; `o|` significa que la clave foránea admite `NULL` y la hija puede tener cero o un padre. `o{` junto a la hija significa que un padre puede tener cero o muchas filas hijas.",
        "",
        "| Tabla padre | Tabla hija | Clave foránea hija → padre | Tipo padre → hija | Referencia en la hija |",
        "|---|---|---|---|---|",
    ])
    for parent, child, _parent_end, _child_end, child_col, parent_col, ratio, nullable in relationships:
        parent_label = "auth.users" if parent == "AUTH_USERS" else f"public.{parent.lower()}"
        lines.append(f"| `{parent_label}` | `public.{child.lower()}` | `{child_col}` → `{parent_col}` | **{ratio}** | {'Opcional (0..1)' if nullable else 'Obligatoria (1)'} |")
    lines.extend([
        "",
        "**Relación N:M derivada:** `body_types` y `flow_stages` se vinculan mediante `product_routes`, cuya clave primaria compuesta es `(product_id, stage_id)`. Cada clave foránea de esa tabla representa una relación física `1:N`; juntas permiten la relación conceptual `N:M` entre productos y fases.",
        "",
        "Los campos de texto sin restricción `FOREIGN KEY` no se presentan como relaciones físicas.",
        "",
    ])
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("schema", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(make_diagram(args.schema.read_text(encoding="utf-8")), encoding="utf-8")
    print(args.output)


if __name__ == "__main__":
    main()
