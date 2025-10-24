import json
from pathlib import Path

try:
    from .records import save_record  # type: ignore
except Exception:
    from records import save_record


def migrate_json_records(json_dir: Path) -> int:
    count = 0
    for path in sorted(json_dir.glob('*.json')):
        with path.open('r', encoding='utf-8') as f:
            data = json.load(f)

        rec_type = data.get('type') or 'questions'
        payload = data.get('payload') or {}
        meta = data.get('meta') or {}
        record_id = data.get('id')
        created_at = data.get('created_at')
        date = data.get('date')

        save_record(
            rec_type,
            payload,
            meta,
            record_id=record_id,
            created_at=created_at,
            date=date,
        )
        count += 1
    return count


def main() -> None:
    base_dir = Path(__file__).resolve().parent.parent
    json_dir = base_dir / 'data' / 'records'
    if not json_dir.exists():
        print('No JSON record directory found.')
        return

    count = migrate_json_records(json_dir)
    print(f'Migrated {count} JSON records into SQLite database.')


if __name__ == '__main__':
    main()
