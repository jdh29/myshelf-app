// Cloudflare Pages Function: GET /api/isbn?isbn=...
// Looks up a book by ISBN via Google Books then Open Library.
// Returns book details plus a cover image as a base64 data URL.

export async function onRequestGet(context) {
  try {
    return await handleLookup(context);
  } catch (err) {
    return json({ error: "Lookup error: " + (err && err.message ? err.message : String(err)) }, 500);
  }
}

async function handleLookup(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const isbnRaw = url.searchParams.get("isbn");
  if (!isbnRaw) return json({ error: "Missing isbn" }, 400);
  // Keep only digits/X, then take the first 13 (some scanners append a
  // supplemental price/region code that breaks lookups).
  let isbn = isbnRaw.replace(/[^0-9Xx]/g, "").toUpperCase();
  if (isbn.length > 13) isbn = isbn.slice(0, 13);
  if (isbn.length !== 10 && isbn.length !== 13) {
    return json({ error: "That barcode isn't a book ISBN (" + isbn + ")" }, 400);
  }

  let result = null;

  // 1. Google Books (best coverage).
  let gbVolumeId = null;
  try {
    const gbKey = env.GOOGLE_BOOKS_KEY;
    const keyParam = gbKey ? `&key=${gbKey}` : "";
    const gbRes = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}${keyParam}`);
    if (gbRes.ok) {
      const gb = await gbRes.json();
      const item = gb.items && gb.items[0];
      const info = item && item.volumeInfo;
      if (item) gbVolumeId = item.id || null;
      if (info) {
        result = {
          title: info.title || "",
          author: (info.authors && info.authors[0]) || "",
          pages: info.pageCount ? String(info.pageCount) : "",
          year: info.publishedDate ? info.publishedDate.slice(0, 4) : "",
          publisher: info.publisher || "",
          genre: (info.categories && info.categories[0]) || "",
          isbn,
          description: info.description ? info.description.slice(0, 220) : "",
          _coverUrl: info.imageLinks
            ? (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail || "").replace(/^http:/, "https:")
            : null,
        };
      }
    }
  } catch {}

  // 2. Open Library edition record fallback.
  try {
    const olRes = await fetch(`https://openlibrary.org/isbn/${isbn}.json`);
    if (olRes.ok) {
      const ed = await olRes.json();
      let author = "";
      try {
        if (ed.authors && ed.authors[0] && ed.authors[0].key) {
          const key = ed.authors[0].key;
          if (/^\/authors\/[A-Za-z0-9]+$/.test(key)) {
            const aRes = await fetch(`https://openlibrary.org${key}.json`);
            if (aRes.ok) { const a = await aRes.json(); author = a.name || ""; }
          }
        }
      } catch {}
      let desc = "";
      if (typeof ed.description === "string") desc = ed.description;
      else if (ed.description && ed.description.value) desc = ed.description.value;
      const olData = {
        title: ed.title || "",
        author,
        pages: ed.number_of_pages ? String(ed.number_of_pages) : "",
        year: ed.publish_date ? (ed.publish_date.match(/\d{4}/) || [""])[0] : "",
        publisher: (ed.publishers && ed.publishers[0]) || "",
        genre: (ed.subjects && ed.subjects[0]) || "",
        isbn,
        description: desc ? desc.slice(0, 220) : "",
        _coverUrl: `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`,
      };
      if (!result) result = olData;
      else {
        for (const k of ["title", "author", "pages", "year", "publisher", "genre", "description"]) {
          if (!result[k] && olData[k]) result[k] = olData[k];
        }
        if (!result._coverUrl) result._coverUrl = olData._coverUrl;
      }
    }
  } catch {}

  if (!result) return json({ error: "No book found for that barcode" }, 404);

  // 3. Open Library search API for any still-missing page count.
  if (!result.pages && result.title) {
    try {
      const q = encodeURIComponent(`${result.title} ${result.author || ""}`.trim());
      const sRes = await fetch(`https://openlibrary.org/search.json?q=${q}&limit=1&fields=number_of_pages_median,first_publish_year,publisher,subject`);
      if (sRes.ok) {
        const s = await sRes.json();
        const doc = s.docs && s.docs[0];
        if (doc) {
          if (!result.pages && doc.number_of_pages_median) result.pages = String(doc.number_of_pages_median);
          if (!result.year && doc.first_publish_year) result.year = String(doc.first_publish_year);
          if (!result.publisher && doc.publisher && doc.publisher[0]) result.publisher = doc.publisher[0];
          if (!result.genre && doc.subject && doc.subject[0]) result.genre = doc.subject[0];
        }
      }
    } catch {}
  }

  // Fetch cover as a data URL, trying several sources in order:
  //  1. Google Books imageLinks (if present)
  //  2. Google Books content cover by volume id (works when imageLinks is absent)
  //  3. Open Library by ISBN
  let cover = null;
  if (result._coverUrl) cover = await fetchCover(result._coverUrl);
  if (!cover && gbVolumeId) {
    cover = await fetchCover(`https://books.google.com/books/content?id=${gbVolumeId}&printsec=frontcover&img=1&zoom=1&source=gbs_api`);
  }
  if (!cover) cover = await fetchCover(`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`);
  delete result._coverUrl;
  result.cover = cover;

  return json(result, 200);
}

async function fetchCover(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 1000) return null;
    const type = res.headers.get("content-type") || "image/jpeg";
    const bytes = new Uint8Array(buf);
    // Encode in chunks to avoid call-stack limits, using a safe base64 approach.
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    const b64 = btoa(binary);
    return `data:${type};base64,${b64}`;
  } catch {
    return null;
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
