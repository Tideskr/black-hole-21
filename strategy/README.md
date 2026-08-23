# v6 strategy certificate

`certificates/v6/proof.json` is the website opening strategy's sole source of truth. With `H1=1` fixed, it records witnesses for:

```text
for every A1, there exists H2;
for every A2, there exists H3;
for every A3, there exists H4.
```

Every selected H4 position was then verified by exact alpha-beta search to be a forced first-player win. The JSON is a strategy witness and computation record; independently confirming every endgame result still requires rerunning `proof/prove_first_player.py`.

- Certificate format: `black-hole-21-first-player-opening-v1`
- Strategy version: 6
- SHA-256: `db99816cc75f3fc5ee50939af8cd8fdf20faf0872e10df0da4705d45d35b4cca`
- Complete first-reply branches: 20
- Selected opening witnesses: `20 × 18 × 16 = 5,760`
- Exact endgame calls: 6,153
- Search nodes: 33,370,517,302
- Measured local four-thread time: 34 minutes 12 seconds

`npm run prepare:strategy` validates the certificate format, checksum, structure, coverage, and move legality before generating compact website assets. Generated files are not a separate source of truth.
