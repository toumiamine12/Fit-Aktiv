import { useEffect, useRef } from "react";
import L from "leaflet";

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende';

function pinIcon(active) {
  return L.divIcon({
    className: "",
    html: `<span class="map-pin${active ? " active" : ""}"></span>`,
    iconSize: [26, 34],
    iconAnchor: [13, 32],
    popupAnchor: [0, -30],
  });
}

function escapeHtml(text = "") {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** Map of all studios with a list next to it. Clicking either selects a studio. */
export default function StudioMap({ studios, selectedId, onSelect, onShowPlan, renderDetails, showList = true }) {
  const mapNode = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map());
  const located = studios.filter((s) => s.latitude && s.longitude);

  // Create the map once.
  useEffect(() => {
    const map = L.map(mapNode.current, {
      scrollWheelZoom: false,
      zoomControl: true,
    });
    L.tileLayer(TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 18,
    }).addTo(map);
    map.setView([51.3, 6.65], 9);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
    };
  }, []);

  // Keep markers in sync with the studio list.
  const studioKey = located.map((s) => `${s.id}:${s.latitude}:${s.longitude}`).join("|");
  useEffect(() => {
    const map = mapRef.current;
    if (!map || located.length === 0) return;
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current.clear();
    for (const studio of located) {
      const marker = L.marker([studio.latitude, studio.longitude], {
        icon: pinIcon(false),
        title: studio.name,
      })
        .addTo(map)
        .bindPopup(
          `<strong>${escapeHtml(studio.name)}</strong><br>${escapeHtml(studio.address)}`,
        );
      marker.on("click", () => onSelect(studio.id));
      markersRef.current.set(String(studio.id), marker);
    }
    map.fitBounds(
      L.latLngBounds(located.map((s) => [s.latitude, s.longitude])),
      { padding: [30, 30] },
    );
    // Markers are only rebuilt when the studios themselves change.
  }, [studioKey]);

  // Highlight the selected studio.
  useEffect(() => {
    markersRef.current.forEach((marker, id) => {
      const active = id === String(selectedId);
      marker.setIcon(pinIcon(active));
      marker.setZIndexOffset(active ? 1000 : 0);
      if (active) {
        marker.openPopup();
        mapRef.current?.panTo(marker.getLatLng());
      }
    });
  }, [selectedId, studioKey]);

  const selected = studios.find((s) => String(s.id) === String(selectedId));

  return (
    <div className="studio-map">
      <div ref={mapNode} className="studio-map-canvas" />
      <div className="studio-map-side">
        {showList && (
          <ul className="studio-list">
            {studios.map((studio) => (
              <li key={studio.id}>
                <button
                  className={String(studio.id) === String(selectedId) ? "active" : ""}
                  onClick={() => onSelect(studio.id)}
                >
                  <strong>{studio.name}</strong>
                  <span>{studio.address}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {selected && (
          <div className="studio-map-selected">
            <strong>{selected.name}</strong>
            <span>{selected.address}</span>
            {renderDetails?.(selected)}
            {onShowPlan && (
              <button onClick={() => onShowPlan(selected.id)}>
                Kursplan dieses Studios
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
