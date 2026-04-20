// Public Events (Firestore v8)
// Views: Month / Week / Day / List
// - Default month view
// - Includes past events
// - Past events display in grey
// - Filter by branch / search
// - Event details modal + registration
// - List view auto-scrolls to current month inside content viewport
// - List items sorted ascending inside each month
// - Thumbnail top title format: 27th @ 10:31am
// - Add to Calendar: Google / Outlook / ICS

(function() {
  // ---------- DOM ----------
  const containerList = document.getElementById("eventsContainer");
  const containerCal  = document.getElementById("calendarContainer");
  const contentViewport = document.getElementById("contentViewport");
  const branchFilter  = document.getElementById("branchFilter");
  const searchInput   = document.getElementById("searchInput");

  // View controls
  const btnMonth = document.getElementById("btnMonth");
  const btnWeek  = document.getElementById("btnWeek");
  const btnDay   = document.getElementById("btnDay");
  const btnList  = document.getElementById("btnList");
  const btnPrev  = document.getElementById("btnPrev");
  const btnNext  = document.getElementById("btnNext");
  const btnToday = document.getElementById("btnToday");
  const calLabel = document.getElementById("calLabel");

  // Registration modal
  const regModalEl = document.getElementById("regModal");
  const regModal   = new bootstrap.Modal(regModalEl);
  const regForm    = document.getElementById("regForm");
  const regEventSummary = document.getElementById("regEventSummary");
  const attendeeName  = document.getElementById("attendeeName");
  const attendeeEmail = document.getElementById("attendeeEmail");
  const regWarn = document.getElementById("regWarn");
  const regErr  = document.getElementById("regErr");
  const regOk   = document.getElementById("regOk");
  const regBusy = document.getElementById("regBusy");
  const btnSubmitReg = document.getElementById("btnSubmitReg");

  // Event Details modal
  const eventModalEl = document.getElementById("eventModal");
  const eventModal   = new bootstrap.Modal(eventModalEl);
  const evTitleEl    = document.getElementById("evTitle");
  const evMetaEl     = document.getElementById("evMeta");
  const evDateLineEl = document.getElementById("evDateLine");
  const evShortDescEl= document.getElementById("evShortDesc");
  const evDetailDescEl = document.getElementById("evDetailDesc");
  const evCapacityEl = document.getElementById("evCapacity");
  const btnOpenRegister = document.getElementById("btnOpenRegister");
  const evBannerBox = document.getElementById("evBannerBox");
  const evBannerImg = document.getElementById("evBannerImg");

  // Add to Calendar buttons
  const addCalGoogle = document.getElementById("addCalGoogle");
  const addCalOutlook = document.getElementById("addCalOutlook");
  const addCalIcs = document.getElementById("addCalIcs");

  // Address + map controls
  const evAddressRow  = document.getElementById("evAddressRow");
  const evAddressText = document.getElementById("evAddressText");
  const evMapLink     = document.getElementById("evMapLink");
  const evMapToggle   = document.getElementById("evMapToggle");
  const evMapEmbed    = document.getElementById("evMapEmbed");
  const evMapIframe   = document.getElementById("evMapIframe");

  // ---------- Config ----------
  const MAPS_EMBED_API_KEY =
    (typeof window !== "undefined" && window.MAPS_EMBED_API_KEY)
      ? String(window.MAPS_EMBED_API_KEY)
      : null;
  const MAP_MODE = "auto";

  // ---------- State ----------
  let allEvents = [];
  let filtered  = [];
  let unsubscribeEvents = null;
  const resourceCache = Object.create(null);

  let currentView = "month";
  let cursorDate  = truncateToDay(new Date());
  let regTarget = null;
  let currentDetailEvent = null;

  // ---------- Utils ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, m => (
    { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]
  ));

  function stripHtmlToText(html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html || "";
    return (tmp.textContent || tmp.innerText || "").trim();
  }

  function toDate(ts) {
    if (!ts) return null;
    if (typeof ts.toDate === "function") return ts.toDate();
    const d = new Date(ts);
    return isNaN(d) ? null : d;
  }

  function fmtDateTime(d) {
    if (!d) return "";
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fmtDate(d) {
    if (!d) return "";
    return d.toLocaleDateString(undefined, {
      weekday:"short",
      month:"short",
      day:"numeric",
      year:"numeric"
    });
  }

  function truncateToDay(d) {
    const x = new Date(d);
    x.setHours(0,0,0,0);
    return x;
  }

  function monthKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  }

  function monthLabel(d) {
    return d.toLocaleString(undefined, { month:"long", year:"numeric" });
  }

  function normalizeHex(c) {
    if (!c) return "#3b82f6";
    let x = String(c).trim();
    if (!x.startsWith("#")) x = "#" + x;
    if (x.length === 4) x = "#" + x[1]+x[1]+x[2]+x[2]+x[3]+x[3];
    return x.toLowerCase();
  }

  function idealTextColor(bgHex) {
    const h = normalizeHex(bgHex).slice(1);
    const r = parseInt(h.substring(0,2),16);
    const g = parseInt(h.substring(2,4),16);
    const b = parseInt(h.substring(4,6),16);
    const yiq = (r*299+g*587+b*114)/1000;
    return yiq >= 150 ? "#000000" : "#ffffff";
  }

  function ensureHttps(url) {
    let s = String(url || "").trim();
    if (!s) return "";
    if (s.startsWith("ttps://")) s = "h" + s;
    if (/^gs:\/\//i.test(s)) return "";
    if (!/^https?:\/\//i.test(s) && !s.startsWith("/")) s = "https://" + s;
    return s;
  }

  function clearRegAlerts() {
    [regWarn, regErr, regOk].forEach(el => {
      el.classList.add("d-none");
      el.textContent = "";
    });
  }

  function isPastEvent(ev) {
    const now = new Date();
    const end = toDate(ev.end) || toDate(ev.start);
    return !!(end && end < now);
  }

  function canRegister(ev) {
    const now = new Date();

    if (ev.status !== "published" || (ev.visibility || "").toLowerCase() !== "public") return false;
    if (ev.allowRegistration === false) return false;

    const opens = toDate(ev.regOpensAt);
    const closes = toDate(ev.regClosesAt);

    if (opens && now < opens) return false;
    if (closes && now > closes) return false;
    if (typeof ev.remaining === "number" && ev.remaining <= 0) return false;

    const start = toDate(ev.start);
    if (start && now > start) return false;

    return true;
  }

  function getEventDisplayColors(ev, fallbackDisabled = false) {
    const past = isPastEvent(ev);

    if (past) {
      return {
        bg: "#e5e7eb",
        border: "#d1d5db",
        text: "#6b7280",
        past: true,
        disabled: true
      };
    }

    const disabled = fallbackDisabled || !canRegister(ev);
    if (disabled) {
      return {
        bg: "#f1f5f9",
        border: "#e2e8f0",
        text: "#64748b",
        past: false,
        disabled: true
      };
    }

    const bg = normalizeHex(ev.color || "#3b82f6");
    return {
      bg,
      border: bg,
      text: idealTextColor(bg),
      past: false,
      disabled: false
    };
  }

  function startOfWeek(d) {
    const x = truncateToDay(d);
    x.setDate(x.getDate() - x.getDay());
    return x;
  }

  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  function activeViewButton() {
    [btnMonth, btnWeek, btnDay, btnList].forEach(b => b.classList.remove("active"));
    if (currentView === "month") btnMonth.classList.add("active");
    else if (currentView === "week") btnWeek.classList.add("active");
    else if (currentView === "day") btnDay.classList.add("active");
    else btnList.classList.add("active");
  }

  function forceDefaultMonthView() {
    currentView = "month";
    cursorDate = truncateToDay(new Date());
    render();
  }

  function getCurrentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  function scrollListToCurrentMonth() {
    if (currentView !== "list") return;
    if (!contentViewport) return;

    requestAnimationFrame(() => {
      const now = new Date();
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);

      const cards = Array.from(containerList.querySelectorAll(".event-card[data-start-ts]"));

      // Find first event starting today or later
      let targetCard = cards.find(card => {
        const ts = Number(card.getAttribute("data-start-ts") || 0);
        return ts >= todayStart.getTime();
      });

      // Fallback to current month header if no upcoming card found
      if (!targetCard) {
        const targetMonthKey = getCurrentMonthKey();
        targetCard = containerList.querySelector(`[data-month-key="${targetMonthKey}"]`);
      }

      if (!targetCard) return;

      const viewportRect = contentViewport.getBoundingClientRect();
      const targetRect = targetCard.getBoundingClientRect();
      const offset = targetRect.top - viewportRect.top + contentViewport.scrollTop - 12;

      contentViewport.scrollTo({
        top: Math.max(0, offset),
        behavior: "smooth"
      });
    });
  }

  function getOrdinalDay(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return `${n}st`;
    if (mod10 === 2 && mod100 !== 12) return `${n}nd`;
    if (mod10 === 3 && mod100 !== 13) return `${n}rd`;
    return `${n}th`;
  }

  function formatThumbTopTitle(startDate) {
    if (!startDate) return "";
    const day = getOrdinalDay(startDate.getDate());
    const time = startDate.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    }).toLowerCase().replace(/\s/g, "");
    return `${day} @ ${time}`;
  }

  function escapeIcsText(str) {
    return String(str || "")
      .replace(/\\/g, "\\\\")
      .replace(/\r?\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");
  }

  function toUtcIcsString(date) {
    const d = new Date(date);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mi = String(d.getUTCMinutes()).padStart(2, "0");
    const ss = String(d.getUTCSeconds()).padStart(2, "0");
    return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`;
  }

  function toGoogleDateString(date) {
    return toUtcIcsString(date);
  }

  function buildGoogleCalendarUrl(payload) {
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: payload.title,
      dates: `${toGoogleDateString(payload.start)}/${toGoogleDateString(payload.end)}`,
      details: payload.description || "",
      location: payload.location || ""
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  function buildOutlookCalendarUrl(payload) {
    const params = new URLSearchParams({
      path: "/calendar/action/compose",
      rru: "addevent",
      subject: payload.title,
      startdt: payload.start.toISOString(),
      enddt: payload.end.toISOString(),
      body: payload.description || "",
      location: payload.location || ""
    });
    return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
  }

  async function getCalendarPayload(ev) {
    if (!ev) throw new Error("No event selected.");

    const start = toDate(ev.start);
    if (!start) throw new Error("Event start time not found.");

    const end = toDate(ev.end) || new Date(start.getTime() + 60 * 60 * 1000);

    let resData = null;
    if (!(ev.address || ev.hmapsUrl || ev.mapsUrl || ev.mapsPlaceId || (isFinite(ev.lat) && isFinite(ev.lng)))) {
      resData = await fetchResourceDataByAny(ev).catch(() => null);
    }

    const meta = pickAddrMeta(ev, resData);
    const location = meta.address || ev.resourceName || resData?.name || "";

    const detailText = stripHtmlToText(ev.detailDescription || "");
    const descParts = [];

    if (ev.description) descParts.push(ev.description);
    if (detailText) descParts.push(detailText);
    if (ev.branch) descParts.push(`Branch: ${ev.branch}`);
    if (location) descParts.push(`Location: ${location}`);

    const description = descParts.join("\n\n");

    return {
      title: ev.title || "Event",
      start,
      end,
      location,
      description
    };
  }

  async function openGoogleCalendar() {
    const payload = await getCalendarPayload(currentDetailEvent);
    window.open(buildGoogleCalendarUrl(payload), "_blank", "noopener");
  }

  async function openOutlookCalendar() {
    const payload = await getCalendarPayload(currentDetailEvent);
    window.open(buildOutlookCalendarUrl(payload), "_blank", "noopener");
  }

  async function downloadIcsFile() {
    const payload = await getCalendarPayload(currentDetailEvent);
    const uid = `event-${Date.now()}@kwliving-events`;
    const stamp = toUtcIcsString(new Date());

    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//KW Living//Event Calendar//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${toUtcIcsString(payload.start)}`,
      `DTEND:${toUtcIcsString(payload.end)}`,
      `SUMMARY:${escapeIcsText(payload.title)}`,
      `DESCRIPTION:${escapeIcsText(payload.description)}`,
      `LOCATION:${escapeIcsText(payload.location)}`,
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");

    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const safeName = (payload.title || "event")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "_");

    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeName || "event"}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- Banner helpers ----------
  function pickBannerUrl(ev) {
    const nested = (obj, path) => {
      try { return path.split(".").reduce((a,k) => (a && a[k] != null ? a[k] : undefined), obj); }
      catch(_){ return undefined; }
    };

    const candidates = [
      ev.bannerThumbUrl,
      ev.bannerUrl,
      nested(ev,"banner.thumbUrl"),
      nested(ev,"banner.url"),
      ev.imageThumbUrl,
      ev.imageUrl,
      ev.coverThumbUrl,
      ev.coverUrl,
      ev.thumbnail,
      ev.thumbnailUrl
    ].filter(Boolean);

    for (const raw of candidates) {
      const u = ensureHttps(raw);
      if (u) return u;
    }
    return "";
  }

  function pickBannerUrlFull(ev) {
    const nested = (obj, path) => {
      try { return path.split(".").reduce((a,k) => (a && a[k] != null ? a[k] : undefined), obj); }
      catch(_){ return undefined; }
    };

    const candidates = [
      ev.bannerUrl,
      nested(ev,"banner.url"),
      ev.imageUrl,
      ev.coverUrl,
      ev.thumbnailUrl,
      ev.bannerThumbUrl,
      nested(ev,"banner.thumbUrl"),
      ev.imageThumbUrl,
      ev.coverThumbUrl,
      ev.thumbnail
    ].filter(Boolean);

    for (const raw of candidates) {
      const u = ensureHttps(raw);
      if (u) return u;
    }
    return "";
  }

  // ---------- Map helpers ----------
  function pickAddrMeta(ev, res) {
    const meta = {
      address     : ev.address ?? res?.address ?? null,
      hmapsUrl    : ensureHttps(ev.hmapsUrl ?? res?.hmapsUrl ?? ""),
      mapsUrl     : ensureHttps(ev.mapsUrl  ?? res?.mapsUrl  ?? ""),
      mapsPlaceId : ev.mapsPlaceId ?? res?.mapsPlaceId ?? null,
      lat         : (ev.lat ?? res?.lat ?? null),
      lng         : (ev.lng ?? res?.lng ?? null),
      label       : (ev.resourceName || ev.title || res?.name || "Location")
    };

    if (meta.lat != null) meta.lat = Number(meta.lat);
    if (meta.lng != null) meta.lng = Number(meta.lng);
    if (!meta.hmapsUrl) delete meta.hmapsUrl;
    if (!meta.mapsUrl)  delete meta.mapsUrl;
    return meta;
  }

  function buildMapTargets(meta) {
    const labelPart = meta.label ? encodeURIComponent(meta.label) : "";
    const addrPart  = meta.address ? encodeURIComponent(meta.address) : "";

    let linkUrl = "";
    if (meta.hmapsUrl) linkUrl = meta.hmapsUrl;
    else if (meta.mapsUrl) linkUrl = meta.mapsUrl;
    else if (meta.mapsPlaceId) linkUrl = `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(meta.mapsPlaceId)}`;
    else if (isFinite(meta.lat) && isFinite(meta.lng)) linkUrl = `https://www.google.com/maps?q=${meta.lat},${meta.lng}`;
    else if (meta.address) linkUrl = `https://www.google.com/maps?q=${labelPart ? labelPart + "%20" : ""}${addrPart}`;

    let embedUrl = null;
    if (MAP_MODE !== "link") {
      if (MAPS_EMBED_API_KEY && meta.mapsPlaceId) {
        embedUrl = `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(MAPS_EMBED_API_KEY)}&q=place_id:${encodeURIComponent(meta.mapsPlaceId)}`;
      } else if (MAPS_EMBED_API_KEY && isFinite(meta.lat) && isFinite(meta.lng)) {
        embedUrl = `https://www.google.com/maps/embed/v1/view?key=${encodeURIComponent(MAPS_EMBED_API_KEY)}&center=${meta.lat},${meta.lng}&zoom=16&maptype=roadmap`;
      } else if (meta.address) {
        embedUrl = `https://www.google.com/maps?q=${addrPart}&output=embed`;
      }
    }

    return { linkUrl, embedUrl, hasEmbed: !!embedUrl };
  }

  function setMapUI(meta) {
    if (!evAddressRow) return;

    const nothing =
      !meta.address && !meta.hmapsUrl && !meta.mapsUrl &&
      !(isFinite(meta.lat) && isFinite(meta.lng)) && !meta.mapsPlaceId;

    if (nothing) {
      evAddressRow.classList.add("d-none");
      evAddressText.textContent = "";
      evMapEmbed?.classList.add("d-none");
      evMapToggle?.classList.add("d-none");
      if (evMapIframe) evMapIframe.removeAttribute("src");
      return;
    }

    evAddressRow.classList.remove("d-none");
    evAddressText.textContent = meta.address || meta.label || "";

    const targets = buildMapTargets(meta);

    if (evMapLink) {
      if (targets.linkUrl) {
        evMapLink.href = targets.linkUrl;
        evMapLink.classList.remove("disabled");
      } else {
        evMapLink.removeAttribute("href");
        evMapLink.classList.add("disabled");
      }
    }

    if (!targets.hasEmbed) {
      evMapEmbed?.classList.add("d-none");
      evMapToggle?.classList.add("d-none");
      if (evMapIframe) evMapIframe.removeAttribute("src");
    } else {
      evMapToggle?.classList.remove("d-none");
      if (evMapToggle) {
        evMapToggle.textContent = "Show map";
        evMapEmbed?.classList.add("d-none");
        if (evMapIframe) evMapIframe.removeAttribute("src");
        evMapToggle.onclick = () => {
          const hidden = evMapEmbed.classList.contains("d-none");
          if (hidden) {
            if (evMapIframe && !evMapIframe.getAttribute("src")) evMapIframe.src = targets.embedUrl;
            evMapEmbed.classList.remove("d-none");
            evMapToggle.textContent = "Hide map";
          } else {
            evMapEmbed.classList.add("d-none");
            evMapToggle.textContent = "Show map";
          }
        };
      }
    }
  }

  // ---------- Filter ----------
  function applyFilter() {
    const q = (searchInput.value || "").toLowerCase().trim();
    const brSel = (branchFilter.value || "ALL").toUpperCase();

    filtered = allEvents.filter(ev => {
      const br = (ev.branch || "").toUpperCase();
      if (brSel !== "ALL" && br !== brSel) return false;

      if (!q) return true;
      const detailTxt = stripHtmlToText(ev.detailDescription || "");
      const hay = [ev.title, ev.description, ev.resourceName, ev.branch, detailTxt]
        .map(v => (v || "").toString().toLowerCase());

      return hay.some(v => v.includes(q));
    });

    render();
  }

  // ---------- Render dispatcher ----------
  function render() {
    activeViewButton();

    if (currentView === "list") {
      containerCal.style.display = "none";
      containerList.style.display = "grid";
      renderList();
      calLabel.textContent = "All Events";
      return;
    }

    containerList.style.display = "none";
    containerCal.style.display = "";

    if (currentView === "month") renderMonth();
    else if (currentView === "week") renderWeek();
    else renderDay();

    if (contentViewport) contentViewport.scrollTo({ top: 0, behavior: "auto" });
  }

  // ---------- List view ----------
  function renderList() {
    if (!filtered.length) {
      containerList.innerHTML = `
        <div class="text-center text-muted py-5">
          <i class="bi bi-calendar-x me-2"></i>No events match your filters.
        </div>`;
      return;
    }

    const groups = {};
    for (const e of filtered) {
      const d = toDate(e.start);
      if (!d) continue;
      const key = monthKey(d);
      (groups[key] ||= { label: monthLabel(d), events: [] }).events.push(e);
    }

    const parts = [];
    Object.keys(groups).sort().forEach(key => {
      const g = groups[key];

      g.events.sort((a, b) => {
        const da = toDate(a.start)?.getTime() || 0;
        const db = toDate(b.start)?.getTime() || 0;
        return da - db;
      });

      parts.push(`<div class="month-header" data-month-key="${esc(key)}">${esc(g.label)}</div>`);
      for (const e of g.events) parts.push(renderEventCard(e));
    });

    containerList.innerHTML = parts.join("");
    scrollListToCurrentMonth();
  }

  function renderEventCard(e) {
    const start = toDate(e.start);
    const end   = toDate(e.end) || start;
    const dateLine = `${fmtDateTime(start)} – ${fmtDateTime(end)}`;
    const thumbTopTitle = formatThumbTopTitle(start);

    const remaining = (typeof e.remaining === "number") ? e.remaining : null;
    const capacity  = (typeof e.capacity === "number") ? e.capacity : null;
    const remainTxt = (remaining != null && capacity != null)
      ? `${remaining}/${capacity} seats left`
      : (remaining != null ? `${remaining} seats left` : "");

    const bannerUrl = pickBannerUrl(e);
    const thumbHtml = bannerUrl
      ? `<img src="${esc(bannerUrl)}" alt="Banner" loading="lazy">`
      : `<div class="thumb-fallback">No Banner</div>`;

    const display = getEventDisplayColors(e);
    const cardClass = display.past ? "event-card past" : "event-card";

    return `
      <div class="${cardClass}" 
        data-id="${esc(e._id)}"
        data-start-ts="${esc(String(toDate(e.start)?.getTime() || 0))}"
        role="button"
        aria-label="${esc(e.title || 'Event')}">
        <div class="event-thumb">
          <div class="thumb-top-title">${esc(thumbTopTitle)}</div>
          <div class="thumb-box">
            ${thumbHtml}
          </div>
        </div>

        <div class="event-body">
          <div class="event-title text-truncate">
            <span style="display:inline-block;width:.7rem;height:.7rem;border-radius:50%;background:${esc(display.bg)};margin-right:.35rem;"></span>
            ${esc(e.title || "Untitled Event")}
          </div>

          <div class="event-meta mt-1">
            <span class="me-2"><i class="bi bi-clock"></i> ${esc(dateLine)}</span>
            ${e.resourceName ? `<span class="badge badge-room me-2"><i class="bi bi-building me-1"></i>${esc(e.resourceName)}</span>` : ""}
            ${e.branch ? `<span class="badge badge-branch me-2">${esc(e.branch)}</span>` : ""}
          </div>

          ${e.description ? `<div class="mt-2 text-secondary text-truncate">${esc(e.description)}</div>` : ""}
        </div>

        <div class="event-aside ms-auto">
          ${remainTxt ? `<div class="small text-muted mb-2">${esc(remainTxt)}</div>` : ""}
          <div class="small text-primary">Details &raquo;</div>
        </div>
      </div>
    `;
  }

  // ---------- Shared ----------
  function eventsInRange(rangeStart, rangeEnd) {
    return filtered.filter(ev => {
      const s = toDate(ev.start);
      const e = toDate(ev.end) || s;
      if (!s || !e) return false;
      return s < rangeEnd && e > rangeStart;
    });
  }

  // ---------- Month ----------
  function renderMonth() {
    const year = cursorDate.getFullYear();
    const month = cursorDate.getMonth();
    calLabel.textContent = cursorDate.toLocaleString(undefined,{month:"long",year:"numeric"});

    const firstOfMonth = new Date(year, month, 1);
    const gridStart = startOfWeek(firstOfMonth);
    const gridEnd = new Date(gridStart);
    gridEnd.setDate(gridStart.getDate() + 42);

    const evs = eventsInRange(gridStart, gridEnd);

    const dayMap = {};
    for (const ev of evs) {
      const s = toDate(ev.start);
      const e = toDate(ev.end) || s;

      let d = truncateToDay(s);
      const last = truncateToDay(e);

      while (d <= last) {
        const key = d.toISOString().slice(0,10);
        (dayMap[key] ||= []).push(ev);
        d.setDate(d.getDate() + 1);
      }
    }

    const weekdays = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      weekdays.push(`<div class="month-head">${d.toLocaleDateString(undefined,{weekday:"short"})}</div>`);
    }

    const cells = [];
    let iter = new Date(gridStart);

    for (let i = 0; i < 42; i++) {
      const isOther = iter.getMonth() !== month;
      const key = iter.toISOString().slice(0,10);
      const items = (dayMap[key] || []).sort((a,b) => (toDate(a.start)?.getTime() || 0) - (toDate(b.start)?.getTime() || 0));

      const evHtml = items.map(e => {
        const display = getEventDisplayColors(e);
        const disable = display.disabled ? "full" : "";
        const pastCls = display.past ? "past" : "";

        return `<button class="month-evt ${disable} ${pastCls}" data-id="${esc(e._id)}"
                        title="${esc(e.title || "")}"
                        style="background:${esc(display.bg)};border-color:${esc(display.border)};color:${esc(display.text)};">
                  ${esc(e.title || "Event")}
                </button>`;
      }).join("");

      cells.push(`
        <div class="month-cell ${isOther ? 'other' : ''}">
          <div class="month-day">${iter.getDate()}</div>
          ${evHtml}
        </div>
      `);

      iter.setDate(iter.getDate() + 1);
    }

    containerCal.innerHTML = `<div class="month-grid">${weekdays.join("")}${cells.join("")}</div>`;
  }

  // ---------- Week ----------
  function renderWeek() {
    const start = startOfWeek(cursorDate);
    const end = addDays(start, 7);

    calLabel.textContent =
      `${start.toLocaleDateString(undefined,{month:"short",day:"numeric"})} – ${new Date(end - 1).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})}`;

    const evs = eventsInRange(start, end);
    const hours = Array.from({length:13}, (_,i) => i + 7);

    const cols = [];
    for (let d = 0; d < 7; d++) {
      const dayDate = addDays(start, d);
      const dayStart = new Date(dayDate);
      const dayEnd = addDays(dayDate, 1);

      const dayEvents = evs.filter(e => {
        const s = toDate(e.start);
        const ee = toDate(e.end) || s;
        return s < dayEnd && ee > dayStart;
      }).sort((a,b)=> (toDate(a.start)?.getTime() || 0) - (toDate(b.start)?.getTime() || 0));

      const slots = hours.map(() => `<div class="time-slot"></div>`).join("");

      const pills = dayEvents.map(e => {
        const s = toDate(e.start);
        const ee = toDate(e.end) || s;

        const startHour = Math.max(0, (s.getHours() - hours[0]) + s.getMinutes()/60);
        const durHours  = Math.max(0.7, ((ee - s) / (1000*60*60)));
        const top = Math.min(hours.length - 0.7, startHour) * 44;
        const height = Math.min(hours.length * 44 - top - 4, Math.max(20, durHours * 44 - 6));

        const display = getEventDisplayColors(e);
        const full = display.disabled ? "full" : "";
        const pastCls = display.past ? "past" : "";

        return `<button class="evt-pill ${full} ${pastCls}" data-id="${esc(e._id)}"
                       style="top:${top+2}px;height:${height}px;background:${esc(display.bg)};border-color:${esc(display.border)};color:${esc(display.text)}"
                       title="${esc(e.title || "")}">
                  ${esc(e.title || "Event")}
                </button>`;
      }).join("");

      cols.push(`<div class="time-col position-relative">${slots}${pills}</div>`);
    }

    const heads = ["","Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((name, idx) => {
      if (idx === 0) return `<div class="time-head"></div>`;
      const d = addDays(start, idx - 1);
      return `<div class="time-head">${name}<br><span class="muted">${d.getMonth()+1}/${d.getDate()}</span></div>`;
    }).join("");

    const labels = hours.map(h => `<div class="slot-label">${String(h).padStart(2,"0")}:00</div>`).join("");

    containerCal.innerHTML = `
      <div class="time-grid">
        ${heads}
        <div class="time-col">${labels}</div>
        ${cols.join("")}
      </div>
    `;
  }

  // ---------- Day ----------
  function renderDay() {
    const start = truncateToDay(cursorDate);
    const end = addDays(start, 1);
    calLabel.textContent = fmtDate(start);

    const evs = eventsInRange(start, end).sort((a,b)=> (toDate(a.start)?.getTime() || 0) - (toDate(b.start)?.getTime() || 0));
    const hours = Array.from({length:13}, (_,i) => i + 7);

    const slots = hours.map(() => `<div class="time-slot"></div>`).join("");

    const pills = evs.map(e => {
      const s = toDate(e.start);
      const ee = toDate(e.end) || s;

      const startHour = Math.max(0, (s.getHours() - hours[0]) + s.getMinutes()/60);
      const durHours  = Math.max(0.7, ((ee - s) / (1000*60*60)));
      const top = Math.min(hours.length - 0.7, startHour) * 44;
      const height = Math.min(hours.length * 44 - top - 4, Math.max(20, durHours * 44 - 6));

      const display = getEventDisplayColors(e);
      const full = display.disabled ? "full" : "";
      const pastCls = display.past ? "past" : "";

      return `<button class="evt-pill ${full} ${pastCls}" data-id="${esc(e._id)}"
                     style="top:${top+2}px;height:${height}px;background:${esc(display.bg)};border-color:${esc(display.border)};color:${esc(display.text)}"
                     title="${esc(e.title || "")}">
                ${esc(e.title || "Event")}
              </button>`;
    }).join("");

    const head = `
      <div class="time-head"></div>
      <div class="time-head" style="grid-column: span 7; text-align:left;">${fmtDate(start)}</div>
    `;
    const labels = hours.map(h => `<div class="slot-label">${String(h).padStart(2,"0")}:00</div>`).join("");

    containerCal.innerHTML = `
      <div class="time-grid">
        ${head}
        <div class="time-col">${labels}</div>
        <div class="time-col position-relative" style="grid-column: span 7;">
          ${slots}
          ${pills}
        </div>
      </div>
    `;
  }

  // ---------- Resource fetch ----------
  async function fetchResourceDataByAny(ev) {
    const rid = ev.resourceId || ev.resourceID || ev.resource || null;
    const rname = ev.resourceName || null;
    const rbranch = ev.branch || null;

    if (rid && resourceCache[`id:${rid}`]) return resourceCache[`id:${rid}`];
    if (rname && resourceCache[`name:${rname}|${rbranch||""}`]) return resourceCache[`name:${rname}|${rbranch||""}`];

    const col = window.db.collection("resources");

    if (rid) {
      try {
        const snap = await col.doc(rid).get();
        if (snap.exists) {
          const data = snap.data();
          resourceCache[`id:${rid}`] = data;
          return data;
        }
      } catch(_) {}
    }

    if (rid) {
      try {
        const q = await col.where("id","==",rid).limit(1).get();
        if (!q.empty) {
          const data = q.docs[0].data();
          resourceCache[`id:${rid}`] = data;
          return data;
        }
      } catch(_) {}
    }

    if (rname) {
      try {
        const q2 = await col.where("name","==",rname).get();
        if (!q2.empty) {
          const all = q2.docs.map(d => d.data());
          let best = all[0];
          if (rbranch) {
            const exact = all.find(x => (x.branch || "") === rbranch);
            if (exact) best = exact;
          }
          resourceCache[`name:${rname}|${rbranch||""}`] = best;
          return best;
        }
      } catch(_) {}
    }

    return null;
  }

  // ---------- Event details ----------
  function openEventDetails(ev) {
    const s = toDate(ev.start);
    const e = toDate(ev.end) || s;
    const dateLine = `${fmtDateTime(s)} – ${fmtDateTime(e)}`;
    const remainTxt = (typeof ev.remaining === "number" && typeof ev.capacity === "number")
      ? `${ev.remaining}/${ev.capacity} seats left`
      : (typeof ev.remaining === "number" ? `${ev.remaining} seats left` : "");
    const canReg = canRegister(ev);
    const display = getEventDisplayColors(ev);

    currentDetailEvent = ev;

    if (evTitleEl) {
      evTitleEl.innerHTML = `
        <span class="me-2" style="display:inline-block;width:.9rem;height:.9rem;border-radius:50%;background:${esc(display.bg)};vertical-align:baseline;"></span>
        ${esc(ev.title || "Event Details")}
      `;
    }

    if (evMetaEl) {
      evMetaEl.innerHTML = `
        ${ev.resourceName ? `<span class="badge badge-room"><i class="bi bi-building me-1"></i>${esc(ev.resourceName)}</span>` : ""}
        ${ev.branch ? `<span class="badge badge-branch">${esc(ev.branch)}</span>` : ""}
        ${ev.status ? `<span class="badge text-bg-light border">${esc(ev.status)}</span>` : ""}
        ${ev.visibility ? `<span class="badge text-bg-light border">${esc(ev.visibility)}</span>` : ""}
      `;
    }

    if (evDateLineEl) evDateLineEl.textContent = dateLine;

    if (evBannerBox && evBannerImg) {
      const fullBanner = pickBannerUrlFull(ev);
      if (fullBanner) {
        evBannerImg.src = fullBanner;
        evBannerImg.alt = ev.title ? `${ev.title} banner` : "Event banner";
        evBannerBox.classList.remove("d-none");
        evBannerImg.onerror = () => {
          evBannerImg.removeAttribute("src");
          evBannerBox.classList.add("d-none");
        };
      } else {
        evBannerImg.removeAttribute("src");
        evBannerBox.classList.add("d-none");
      }
    }

    evAddressRow?.classList.add("d-none");
    evAddressText.textContent = "";
    evMapEmbed?.classList.add("d-none");
    evMapToggle?.classList.add("d-none");
    if (evMapIframe) evMapIframe.removeAttribute("src");

    const applyMeta = (resData) => {
      const meta = pickAddrMeta(ev, resData);
      setMapUI(meta);
    };

    if (ev.address || ev.hmapsUrl || ev.mapsUrl || ev.mapsPlaceId || (isFinite(ev.lat) && isFinite(ev.lng))) {
      applyMeta(null);
    } else {
      fetchResourceDataByAny(ev).then(applyMeta).catch(() => setMapUI({}));
    }

    if (evShortDescEl) {
      if (ev.description) {
        evShortDescEl.textContent = ev.description;
        evShortDescEl.style.display = "";
      } else {
        evShortDescEl.style.display = "none";
      }
    }

    if (evDetailDescEl) {
      if (ev.detailDescription) {
        evDetailDescEl.innerHTML = ev.detailDescription;
        evDetailDescEl.style.display = "";
      } else {
        evDetailDescEl.style.display = "none";
      }
    }

    if (evCapacityEl) evCapacityEl.textContent = remainTxt || "";

    if (btnOpenRegister) {
      btnOpenRegister.disabled = !canReg;
      btnOpenRegister.onclick = () => {
        regTarget = ev;
        regEventSummary.innerHTML = `
          <div><strong>${esc(ev.title || "")}</strong></div>
          <div class="text-secondary small">${esc(ev.resourceName || "")} · ${esc(ev.branch || "")}</div>
          <div class="text-secondary small">${esc(fmtDateTime(s))} – ${esc(fmtDateTime(e))}</div>
        `;
        attendeeName.value = "";
        attendeeEmail.value = "";
        clearRegAlerts();
        btnSubmitReg.disabled = false;
        regBusy.classList.add("d-none");
        eventModal.hide();
        regModal.show();
      };
    }

    eventModal.show();
  }

  // ---------- Data load ----------
  async function loadBranches() {
    const set = new Set();

    try {
      const resSnap = await window.db.collection("resources").get();
      resSnap.forEach(d => {
        const br = (d.data()?.branch || "").trim();
        if (br) set.add(br);
      });
    } catch (err) {
      console.warn("Failed to read resources for branches:", err);
    }

    if (set.size === 0) {
      try {
        const evSnap = await window.db.collection("events")
          .where("visibility", "==", "public")
          .where("status", "==", "published")
          .get();

        evSnap.forEach(d => {
          const ev = d.data();
          const br = (ev?.branch || "").trim();
          if (br) set.add(br);
        });
      } catch (err) {
        console.warn("Failed to read events for branches:", err);
      }
    }

    const branches = Array.from(set).sort((a,b) => a.localeCompare(b));
    const opts = [`<option value="ALL">All locations</option>`]
      .concat(branches.map(b => `<option value="${esc(b)}">${esc(b)}</option>`));
    branchFilter.innerHTML = opts.join("");
  }

  function attachEventsListener() {
    if (typeof unsubscribeEvents === "function") {
      unsubscribeEvents();
      unsubscribeEvents = null;
    }

    const col = window.db.collection("events");

    try {
      unsubscribeEvents = col
        .where("visibility","==","public")
        .where("status","==","published")
        .orderBy("start","desc")
        .onSnapshot(snap => {
          allEvents = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
          applyFilter();
        }, err => {
          console.warn("events preferred query error; falling back:", err);
          fallbackEventsListener();
        });
    } catch (err) {
      console.warn("events preferred query threw; falling back:", err);
      fallbackEventsListener();
    }
  }

  function fallbackEventsListener() {
    const col = window.db.collection("events");

    try {
      unsubscribeEvents = col.onSnapshot(snap => {
        const rows = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
        allEvents = rows
          .filter(ev => ev.visibility === "public" && ev.status === "published")
          .sort((a,b) => {
            const da = toDate(a.start)?.getTime() || 0;
            const db = toDate(b.start)?.getTime() || 0;
            return db - da;
          });
        applyFilter();
      }, err => {
        console.error("events fallback listener failed:", err);
        containerList.innerHTML = `<div class="text-danger py-4 text-center">Failed to load events.</div>`;
      });
    } catch (err) {
      console.error("events fallback threw:", err);
      containerList.innerHTML = `<div class="text-danger py-4 text-center">Failed to load events.</div>`;
    }
  }

  // ---------- Registration submit ----------
  regForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearRegAlerts();
    btnSubmitReg.disabled = true;
    regBusy.classList.remove("d-none");

    try {
      if (!regTarget) throw new Error("No event selected.");

      const name = attendeeName.value.trim();
      const email = attendeeEmail.value.trim().toLowerCase();

      if (!name || !email || !/^\S+@\S+\.\S+$/.test(email)) {
        throw new Error("Please enter a valid name and email.");
      }

      const eventRef = window.db.collection("events").doc(regTarget._id);
      const regId = `${regTarget._id}_${email}`;
      const regRef = window.db.collection("eventRegistrations").doc(regId);

      await window.db.runTransaction(async (tx) => {
        const [evSnap, regSnap] = await Promise.all([tx.get(eventRef), tx.get(regRef)]);
        if (!evSnap.exists) throw new Error("Event not found.");

        const ev = evSnap.data();

        if (ev.status !== "published" || ev.visibility !== "public") throw new Error("Registration is closed for this event.");

        const now = new Date();
        const opens = ev.regOpensAt?.toDate ? ev.regOpensAt.toDate() : (ev.regOpensAt ? new Date(ev.regOpensAt) : null);
        const closes = ev.regClosesAt?.toDate ? ev.regClosesAt.toDate() : (ev.regClosesAt ? new Date(ev.regClosesAt) : null);

        if (ev.allowRegistration === false) throw new Error("Registration is not allowed for this event.");
        if (opens && now < opens) throw new Error("Registration has not opened yet.");
        if (closes && now > closes) throw new Error("Registration has closed.");

        const start = ev.start?.toDate ? ev.start.toDate() : (ev.start ? new Date(ev.start) : null);
        if (start && now > start) throw new Error("This event has already started.");

        if (regSnap.exists && regSnap.data().status === "registered") throw new Error("You're already registered for this event.");
        if (typeof ev.remaining === "number" && ev.remaining <= 0) throw new Error("This event is full.");

        tx.set(regRef, {
          eventId: eventRef.id,
          eventTitle: ev.title || "",
          start: ev.start || null,
          attendeeEmail: email,
          attendeeName: name,
          status: "registered",
          createdAt: new Date()
        });

        if (typeof ev.remaining === "number") {
          tx.update(eventRef, { remaining: ev.remaining - 1 });
        }
      });

      regOk.classList.remove("d-none");
      regOk.textContent = "Registration successful! Check your email.";
      regErr.classList.add("d-none");

      window.dispatchEvent(new CustomEvent("event:registered", {
        detail: { event: regTarget, attendee: { name, email } }
      }));

      setTimeout(() => regModal.hide(), 1200);

    } catch (err) {
      console.error("registration error:", err);
      regErr.textContent = err.message || "Registration failed. Please try again.";
      regErr.classList.remove("d-none");
    } finally {
      regBusy.classList.add("d-none");
      btnSubmitReg.disabled = false;
    }
  });

  // ---------- Add to Calendar ----------
  if (addCalGoogle) {
    addCalGoogle.addEventListener("click", async () => {
      try {
        await openGoogleCalendar();
      } catch (err) {
        console.error(err);
        alert(err.message || "Unable to add this event to Google Calendar.");
      }
    });
  }

  if (addCalOutlook) {
    addCalOutlook.addEventListener("click", async () => {
      try {
        await openOutlookCalendar();
      } catch (err) {
        console.error(err);
        alert(err.message || "Unable to add this event to Outlook.");
      }
    });
  }

  if (addCalIcs) {
    addCalIcs.addEventListener("click", async () => {
      try {
        await downloadIcsFile();
      } catch (err) {
        console.error(err);
        alert(err.message || "Unable to download calendar file.");
      }
    });
  }

  // ---------- Navigation ----------
  function gotoToday() {
    cursorDate = truncateToDay(new Date());
    render();
  }

  function prevPeriod() {
    if (currentView === "month") {
      const d = new Date(cursorDate);
      d.setMonth(d.getMonth() - 1);
      cursorDate = truncateToDay(d);
    } else if (currentView === "week") {
      const d = new Date(cursorDate);
      d.setDate(d.getDate() - 7);
      cursorDate = truncateToDay(d);
    } else if (currentView === "day") {
      const d = new Date(cursorDate);
      d.setDate(d.getDate() - 1);
      cursorDate = truncateToDay(d);
    }
    render();
  }

  function nextPeriod() {
    if (currentView === "month") {
      const d = new Date(cursorDate);
      d.setMonth(d.getMonth() + 1);
      cursorDate = truncateToDay(d);
    } else if (currentView === "week") {
      const d = new Date(cursorDate);
      d.setDate(d.getDate() + 7);
      cursorDate = truncateToDay(d);
    } else if (currentView === "day") {
      const d = new Date(cursorDate);
      d.setDate(d.getDate() + 1);
      cursorDate = truncateToDay(d);
    }
    render();
  }

  // ---------- Delegation ----------
  document.addEventListener("click", (ev) => {
    const card = ev.target.closest(".event-card");
    const monthBtn = ev.target.closest(".month-evt");
    const pill = ev.target.closest(".evt-pill");
    const el = card || monthBtn || pill;

    if (!el) return;

    const id = el.getAttribute("data-id");
    if (!id) return;

    const eventObj = allEvents.find(x => x._id === id);
    if (!eventObj) return;

    openEventDetails(eventObj);
  });

  // ---------- Prevent restore old cached UI ----------
  window.addEventListener("pageshow", function(event) {
    if (event.persisted) {
      forceDefaultMonthView();
    }
  });

  // ---------- Init ----------
  document.addEventListener("DOMContentLoaded", async () => {
    if (!window.db) {
      containerList.innerHTML = `<div class="text-danger py-4 text-center">Firestore not initialized.</div>`;
      return;
    }

    currentView = "month";
    cursorDate = truncateToDay(new Date());

    await loadBranches();
    attachEventsListener();

    branchFilter.addEventListener("change", applyFilter);
    searchInput.addEventListener("input", () => {
      clearTimeout(searchInput._t);
      searchInput._t = setTimeout(applyFilter, 120);
    });

    btnMonth.addEventListener("click", () => { currentView = "month"; render(); });
    btnWeek .addEventListener("click", () => { currentView = "week";  render(); });
    btnDay  .addEventListener("click", () => { currentView = "day";   render(); });
    btnList .addEventListener("click", () => { currentView = "list";  render(); });

    btnToday.addEventListener("click", gotoToday);
    btnPrev .addEventListener("click", prevPeriod);
    btnNext .addEventListener("click", nextPeriod);

    render();
  });
})();