import argparse, sqlite3, pathlib

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', required=True)
    ap.add_argument('--schema', required=True)
    args = ap.parse_args()

    dbp = pathlib.Path(args.db)
    dbp.parent.mkdir(parents=True, exist_ok=True)

    con = sqlite3.connect(str(dbp))
    with open(args.schema, 'r', encoding='utf-8') as f:
        con.executescript(f.read())
    con.commit()
    con.close()
    print(f"Initialized DB at {dbp}")

if __name__ == '__main__':
    main()
