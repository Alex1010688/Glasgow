/* Hidden linear reference lookup; never returns a track identifier. */
(function(root) {
  "use strict";
  const R = 6371008.8;
  const RAD = Math.PI / 180;

  function project(point, coords) {
    const scaleX = R * RAD * Math.cos(point.lat * RAD);
    const scaleY = R * RAD;
    let total = 0;
    let best = null;
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1], b = coords[i];
      const ax = (a[0] - point.lng) * scaleX;
      const ay = (a[1] - point.lat) * scaleY;
      const dx = (b[0] - a[0]) * scaleX;
      const dy = (b[1] - a[1]) * scaleY;
      const length = Math.hypot(dx, dy);
      if (!length) continue;
      const arcLength = Math.hypot((b[0] - a[0]) * R * RAD * Math.cos((a[1] + b[1]) / 2 * RAD), dy);
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (length * length)));
      const distance = Math.hypot(ax + t * dx, ay + t * dy);
      if (!best || distance < best.distance) best = { distance, along: total + t * arcLength };
      total += arcLength;
    }
    return best && total > 0 ? { distance: best.distance, fraction: best.along / total } : null;
  }

  function formatMileage(yards) {
    if (!Number.isFinite(yards)) return "Unavailable";
    const rounded = Math.round(Math.abs(yards));
    return `${yards < 0 && rounded ? "−" : ""}${Math.floor(rounded / 1760)}m ${rounded % 1760}yd`;
  }

  function positionAtFraction(coords, fraction) {
    const lengths = coords.slice(1).map((b, i) => {
      const a = coords[i];
      return Math.hypot((b[0] - a[0]) * R * RAD * Math.cos((a[1] + b[1]) / 2 * RAD),
        (b[1] - a[1]) * R * RAD);
    });
    let remaining = lengths.reduce((sum, length) => sum + length, 0) * fraction;
    for (let i = 0; i < lengths.length; i++) {
      if (remaining <= lengths[i] && lengths[i] > 0) {
        const t = remaining / lengths[i], a = coords[i], b = coords[i + 1];
        return { lng: a[0] + t * (b[0] - a[0]), lat: a[1] + t * (b[1] - a[1]) };
      }
      remaining -= lengths[i];
    }
    const last = coords[coords.length - 1];
    return { lng: last[0], lat: last[1] };
  }

  function distanceBetween(a, b) {
    return Math.hypot((a.lng - b.lng) * R * RAD * Math.cos((a.lat + b.lat) / 2 * RAD),
      (a.lat - b.lat) * R * RAD);
  }

  function uniqueLocations(locations) {
    return locations.filter((location, i) => !locations.slice(0, i).some(other =>
      other.elr === location.elr && distanceBetween(location, other) < 20));
  }

  function interpolate(anchors, fraction) {
    for (let i = 1; i < anchors.length; i++) {
      const [start, from] = anchors[i - 1], [end, to] = anchors[i];
      if (fraction <= end) {
        return from + (to - from) * Math.max(0, Math.min(1, (fraction - start) / (end - start)));
      }
    }
    return anchors[anchors.length - 1][1];
  }

  function createIndex(links) {
    const prepared = links.filter(link =>
      typeof link.elr === "string" && link.elr && Array.isArray(link.coords) &&
      link.coords.length >= 2 && link.coords.every(c => c.length >= 2 && c.every(Number.isFinite)) &&
      Array.isArray(link.anchors) && link.anchors.length >= 2 &&
      link.anchors.every((a, i) => a.length === 2 && a.every(Number.isFinite) &&
        (!i || a[0] > link.anchors[i - 1][0])) &&
      link.anchors[0][0] === 0 && link.anchors[link.anchors.length - 1][0] === 1
    ).map(link => {
      const xs = link.coords.map(c => c[0]), ys = link.coords.map(c => c[1]);
      return { ...link, west: Math.min(...xs), east: Math.max(...xs),
        south: Math.min(...ys), north: Math.max(...ys) };
    });

    return {
      lookup(point, maxDistance = 20) {
        if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return { status: "unavailable" };
        const dy = maxDistance / (R * RAD);
        const dx = dy / Math.cos(point.lat * RAD);
        const candidates = [];
        for (const link of prepared) {
          if (point.lng < link.west - dx || point.lng > link.east + dx ||
              point.lat < link.south - dy || point.lat > link.north + dy) continue;
          const snapped = project(point, link.coords);
          if (snapped && snapped.distance <= maxDistance) {
            candidates.push({ elr: link.elr, yards: interpolate(link.anchors, snapped.fraction),
              distance: snapped.distance });
          }
        }
        candidates.sort((a, b) => a.distance - b.distance);
        if (!candidates.length) return { status: "unavailable" };
        const nearest = candidates[0];
        return { status: "ok", locations: [{ ...nearest, mileage: formatMileage(nearest.yards) }] };
      },

      findMileage(elr, yards) {
        if (typeof elr !== "string" || !Number.isFinite(yards)) return [];
        const matches = [];
        for (const link of prepared) {
          if (link.elr.toUpperCase() !== elr.trim().toUpperCase()) continue;
          for (let i = 1; i < link.anchors.length; i++) {
            const [start, from] = link.anchors[i - 1], [end, to] = link.anchors[i];
            if (from === to || yards < Math.min(from, to) || yards > Math.max(from, to)) continue;
            const fraction = start + (end - start) * (yards - from) / (to - from);
            matches.push({ elr: link.elr, mileage: formatMileage(yards),
              ...positionAtFraction(link.coords, fraction) });
          }
        }
        return uniqueLocations(matches);
      }
    };
  }

  const api = { createIndex, formatMileage, uniqueLocations };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RailMileage = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
