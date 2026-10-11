"""Import the recovered stored records into a portable, normalized SQLite database."""
import argparse
import hashlib
import json
import sqlite3
from collections import Counter
from pathlib import Path


def number(value: str) -> int:
    if len(value) != 14 or value[0] not in "0-":
        raise ValueError(f"Unexpected legacy numeric encoding: {value!r}")
    return int(value[1:], 36) + (-2**63 if value[0] == "-" else 0)


def records(path: Path):
    with path.open(encoding="utf-8") as source:
        for line in source:
            yield json.loads(line)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True, help="Directory containing en-records.jsonl and synset-records.jsonl")
    parser.add_argument("--output", type=Path, default=Path("data/dictionary.sqlite"))
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(".building.sqlite")
    temporary.unlink(missing_ok=True)
    db = sqlite3.connect(temporary)
    db.executescript("""
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        CREATE TABLE words(id INTEGER PRIMARY KEY, text TEXT NOT NULL UNIQUE, norm TEXT NOT NULL, frequency REAL NOT NULL DEFAULT 0);
        CREATE TABLE meanings(id INTEGER PRIMARY KEY, pos TEXT NOT NULL, definition TEXT NOT NULL DEFAULT '', examples TEXT NOT NULL DEFAULT '[]');
        CREATE TABLE memberships(word_id INTEGER NOT NULL REFERENCES words(id), meaning_id INTEGER NOT NULL REFERENCES meanings(id), ordinal INTEGER NOT NULL, weight REAL NOT NULL, PRIMARY KEY(word_id,meaning_id));
        CREATE TABLE relations(source INTEGER NOT NULL REFERENCES meanings(id), target INTEGER NOT NULL REFERENCES meanings(id), type TEXT NOT NULL, from_word TEXT NOT NULL DEFAULT '', to_word TEXT NOT NULL DEFAULT '', PRIMARY KEY(source,target,type,from_word,to_word));
        CREATE TABLE stems(form TEXT NOT NULL, word TEXT NOT NULL, PRIMARY KEY(form,word));
        CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    """)
    counts = Counter()
    pos = {"n": "noun", "v": "verb", "a": "adjective", "s": "adjective", "r": "adverb"}
    for d in records(args.source / "synset-records.jsonl"):
        counts["synset_records"] += 1
        if "sense" not in d:
            db.execute("INSERT INTO metadata VALUES (?,?)", ("synset_header", json.dumps(d)))
            continue
        sid = number(d["sense"][0])
        db.execute("INSERT INTO meanings(id,pos) VALUES (?,?)", (sid, pos[d["pos"][0]]))
        types, targets = d.get("synset_pointertype", []), d.get("synset_toid", [])
        assert len(types) == len(targets), ("synset pointer alignment", sid)
        db.executemany("INSERT OR IGNORE INTO relations(source,target,type) VALUES (?,?,?)", [(sid, number(target), kind) for kind, target in zip(types, targets)])
    for d in records(args.source / "en-records.jsonl"):
        counts["english_records"] += 1
        if "word" in d:
            cur = db.execute("INSERT INTO words(text,norm,frequency) VALUES (?,?,?)", (d["word"][0], d["norm"][0], float(d.get("word_freq", ["0"])[0])))
            ids, orders, weights = d["word_synsetid"], d["word_sense"], d["link_weight"]
            assert len(ids) == len(orders) == len(weights), ("word sense alignment", d["word"])
            db.executemany("INSERT OR IGNORE INTO memberships VALUES (?,?,?,?)", [(cur.lastrowid, number(sid), number(order), float(weight)) for sid, order, weight in zip(ids, orders, weights)])
        elif "definition" in d:
            db.execute("UPDATE meanings SET definition=?,examples=? WHERE id=?", (d["definition"][0], json.dumps(d.get("example", [])), number(d["definition_synsetid"][0])))
        elif "lexicalptr_fromid" in d:
            keys = ["lexicalptr_type", "lexicalptr_toid", "lexicalptr_fromword", "lexicalptr_toword"]
            assert len({len(d[k]) for k in keys}) == 1, "lexical pointer alignment"
            sid = number(d["lexicalptr_fromid"][0])
            db.executemany("INSERT OR IGNORE INTO relations VALUES (?,?,?,?,?)", [(sid, number(target), kind, word, to_word) for kind, target, word, to_word in zip(*(d[k] for k in keys))])
        elif "stem_word" in d:
            db.executemany("INSERT OR IGNORE INTO stems VALUES (?,?)", [(d["stem_word"][0], word) for word in d["stem_stem"]])
        elif "header_major" in d:
            db.execute("INSERT INTO metadata VALUES (?,?)", ("english_header", json.dumps(d)))
    db.executescript("""
        CREATE INDEX words_norm ON words(norm);
        CREATE INDEX memberships_meaning ON memberships(meaning_id);
        CREATE INDEX relations_target ON relations(target);
        CREATE INDEX relations_source_type ON relations(source,type);
        PRAGMA user_version=1;
    """)
    violations = db.execute("PRAGMA foreign_key_check").fetchall()
    if violations:
        raise ValueError(f"Broken dictionary references: {violations[:10]}")
    stats = {"words": db.execute("SELECT count(*) FROM words").fetchone()[0], "meanings": db.execute("SELECT count(*) FROM meanings").fetchone()[0], "relationships": db.execute("SELECT count(*) FROM relations").fetchone()[0], "definitions": db.execute("SELECT count(*) FROM meanings WHERE definition!=''").fetchone()[0], "memberships": db.execute("SELECT count(*) FROM memberships").fetchone()[0]}
    provenance = {"installer_sha256": "a0097ecbcb875deacb59a2b6b57b5ee01018dc20f2af3920cf1f03cb3d344f61", "source": "User-supplied Visual Thesaurus 3.0.3 Windows installer", "extraction": "Bundled read-only Lucene reader, no application launch", "record_counts": dict(counts), "stats": stats, "record_sha256": {name: hashlib.sha256((args.source / name).read_bytes()).hexdigest() for name in ["en-records.jsonl", "synset-records.jsonl"]}}
    db.execute("INSERT INTO metadata VALUES ('stats',?)", (json.dumps(stats),))
    db.execute("INSERT INTO metadata VALUES ('provenance',?)", (json.dumps(provenance),))
    db.commit()
    integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
    assert integrity == "ok", integrity
    db.close()
    temporary.replace(args.output)
    args.output.with_name("provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
