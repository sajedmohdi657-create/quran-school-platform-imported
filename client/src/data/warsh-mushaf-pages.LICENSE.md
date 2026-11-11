# Warsh mushaf page index and mushaf source attribution

## Page navigation metadata

The page-to-ayah index in `warsh-mushaf-pages.json` is sourced from:

- Project: [Quran Tajweed Engine](https://github.com/TheAbubakrAbu/Quran-Tajweed-Engine)
- File: `data/mushaf/pages/warsh.json`
- Upstream license: MIT
- Copyright: © 2026 Abubakr Elmallah

The upstream project credits the Quran text and qiraat data to quran-data-kfgqpc (KFGQPC). This file contains navigation metadata only, not Quran page artwork or printed mushaf scans.

## Embedded mushaf source

The temporary in-platform reader uses the following publication:

- Title: مصحف التجويد الملون بتوسط البدل (رواية ورش عن نافع)
- Publisher/source: IslamHouse / IslamContent
- IslamContent item: https://islamcontent.com/ar/content/2885
- IslamHouse item: https://islamhouse.com/ar/books/2790112/
- File format and published size: PDF, 338 MB
- API item endpoint (returns item metadata and attachments): https://api3.islamhouse.com/v3/paV29H2gm56kvLPy/main/get-item/2790112/ar/json

IslamHouse-API's published content policy explicitly permits downloading, republishing, storing for offline use, and integrating IslamHouse materials into apps and websites, including commercial and non-commercial projects, without prior written permission, provided the original material and metadata remain unchanged and the source is clearly credited:
https://github.com/IslamHouse-API/multilingual-quran-hadith-islamic-content-database-api-hub

The PDF is displayed from the publisher's attachment URL and is not committed to this Git repository or copied into the Vercel deployment. The original pages and text must not be modified. The source attribution must remain visible in the reader.

The selected ayah range is mapped to a page using the MIT-licensed Warsh page index. The current reader navigates to the starting page; precise visual highlighting over individual words/ayahs requires page-coordinate annotation data and is not claimed by this implementation.

This temporary source is not the Dar al-Ma'rifah edition. It may be replaced later without changing the page-index interface.
