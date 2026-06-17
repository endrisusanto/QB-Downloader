# RAONK Workflow Spy

Unpacked Chrome/Edge extension untuk mengintip workflow RAON K dari halaman browser.

## Cara Pakai

1. Buka Chrome/Edge ke `chrome://extensions` atau `edge://extensions`.
2. Aktifkan `Developer mode`.
3. Klik `Load unpacked`.
4. Pilih folder ini: `tools/raonk-workflow-spy`.
5. Buka halaman web yang memunculkan dialog RAON K.
6. Centang file seperti biasa, lalu klik download.
7. Klik icon extension `RAONK Spy`.
8. Kalau halaman mulai berat, klik `Pause` dulu.
9. Klik `Export JSON`.

## Yang Dicapture

- Call JavaScript yang mengandung kata kunci RAON/download.
- `fetch`, `XMLHttpRequest`, `WebSocket`, `postMessage`, form submit, dan klik tombol download.
- Snapshot saat tombol download diklik: checkbox/input relevan dan global RAON seperti `raonkUploadFileInfo`, `RAONKUPLOAD`, `raonkServerDataPath`.
- Response text XHR/fetch yang relevan, termasuk config RAON, dengan ukuran preview dibatasi.
- Request/response headers untuk URL/header yang mengandung:
  - `raonk`
  - `download`
  - `endpoint`
  - `handler`
  - `cache_key`
  - `method=file_end`
  - `x-raon`
  - `range`
  - `quickbuild`, `qb`, `ads5`, `android`

Header sensitif seperti `Authorization`, `Cookie`, `Token`, `Password`, dan `Secret` otomatis direduksi menjadi `<redacted>`.

## Performa

- Event disimpan di memory dan di-flush batch ke `chrome.storage`, bukan setiap request.
- Popup hanya menampilkan 30 event terakhir sebagai preview ringan.
- Detail JSON tiap event baru dirender saat item `Details` dibuka.
- Maksimal event disimpan: 800 event terakhir.
- Gunakan tombol `Pause` sebelum export jika halaman target sangat ramai.

## Catatan Penting

- Extension Chrome/Edge tidak bisa melihat call ActiveX di Internet Explorer murni atau IE Mode secara sempurna.
- Kalau RAON dipanggil lewat halaman modern, payload biasanya terlihat dari XHR/fetch/form/postMessage.
- Kalau payload tidak muncul, gunakan DevTools Network lalu cari request sebelum dialog RAON tampil.
- Fokus field yang dicari:
  - `endpoints`
  - `downloadcache`
  - `target`
  - `size`
  - `header`
  - `auth`
  - `Handler-URL`
  - `Download-URL`
  - `cache_key`
  - `Range`
  - `Content-Range`
  - `X-raon-*`
