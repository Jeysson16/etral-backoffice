"""Keep the thesis annex ER section aligned with the detailed diagram."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ANNEX = ROOT / "docs" / "anexo-tecnico-arquitectura-diagramas-y-codigo.md"
DETAIL = ROOT / "docs" / "diagrama-entidad-relacion.md"


def main():
    text = ANNEX.read_text(encoding="utf-8")
    diagram = DETAIL.read_text(encoding="utf-8")
    block = diagram[diagram.index("```mermaid") : diagram.index("```", diagram.index("```mermaid") + 3) + 3]
    section = (
        "## 7. Diagrama entidad-relacion\n\n"
        + block
        + "\n\nEl esquema entregado contiene 28 tablas de `public` y 40 claves foráneas declaradas. "
        "La relación de `simulation_runs.created_by` apunta a `auth.users`; la interfaz actual "
        "muestra las corridas en sesión, sin guardarlas en esa tabla. El "
        "[diagrama independiente](diagrama-entidad-relacion.md) explica las claves y la cardinalidad.\n\n"
    )
    start = text.index("## 7. Diagrama entidad-relacion")
    end = text.index("## 8. Ejemplos de codigo", start)
    text = text[:start] + section + text[end:]
    old = "`simulation_runs` conserva parametros y resultados en JSONB para comparar corridas del gemelo digital."
    new = "`simulation_runs` admite parametros y resultados en JSONB, pero la interfaz actual no guarda corridas en esa tabla."
    text = text.replace(old, new)
    ANNEX.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
