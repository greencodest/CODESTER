# PHMS – Seva ya Sync (GitHub database)

Mfumo (`index.html`) unahifadhi data kwenye faili la JSON ndani ya repo **private** ya GitHub.
Token ya GitHub inakaa kwenye seva tu; kivinjari kinatumia `SYNC_KEY`.

## 1. GitHub
1. Tengeneza repo **private** (mf. `phms-data`).
2. Settings → Developer settings → Fine-grained tokens → chagua repo hiyo tu → **Contents: Read and write**.

## 2. Seva
```bash
cp .env.example .env     # jaza thamani
npm install
npm start                # http://localhost:3000
```
Hosting: Render / Railway / Fly.io / VPS yoyote yenye Node 18+. Weka variables za `.env` kama Environment Variables, na `TRUST_PROXY=1`. Tumia **HTTPS**.

## 3. Mfumo
Fungua anwani ya seva → skrini ya kuingia → **🐙 Mipangilio ya GitHub**:
- Anwani ya seva: acha wazi (mfumo unatoka kwenye seva ileile)
- Ufunguo wa sync: thamani ya `SYNC_KEY`
- Nenosiri la usimbaji: liwe sawa kwenye vifaa vyote (usilisahau – data haisomeki bila hilo)

## Usalama
- Data husimbwa (AES-256-GCM) kwenye kivinjari kabla ya kufika GitHub.
- Badilisha `SYNC_KEY` kwenye seva ili kuzuia vifaa vya zamani.
- Rate limit: maombi 120/dakika kwa IP.
- Kuingia (login) bado kunafanyika kwenye kivinjari; seva inalinda faili la data kwa `SYNC_KEY` tu.
