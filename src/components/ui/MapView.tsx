// Hallmark Component · MapView (Geofence & Precision Radar HUD)
// Anti-AI-slop: Precision geographic HUD, clean radar pulse (redup nyala), crisp hairline boundaries, super zoom enabled.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { OfficeSettings } from '../../types/attendance';
import { colors, radius } from '../../theme';

interface MapViewProps {
  userLat: number;
  userLng: number;
  officeLat: number;
  officeLng: number;
  radiusMeters: number;
  /** Semua titik kantor untuk digambar sekaligus (opsional, fallback ke 1 titik di atas). */
  offices?: Pick<OfficeSettings, 'id' | 'officeName' | 'latitude' | 'longitude' | 'radiusMeters' | 'color'>[];
  /** ID titik kantor yang sedang aktif / terpilih (untuk highlight). */
  activeOfficeId?: string | null;
  /** Warna lingkaran + penanda utama (default biru). */
  mainColor?: string;
  height?: number;
  interactivePicker?: boolean;
  onLocationSelect?: (lat: number, lng: number) => void;
}

export const MapView: React.FC<MapViewProps> = ({
  userLat,
  userLng,
  officeLat,
  officeLng,
  radiusMeters,
  offices,
  activeOfficeId,
  mainColor,
  height = 220,
  interactivePicker = false,
  onLocationSelect,
}) => {
  const iframeRef = useRef<any>(null);

  const main = /^#[0-9a-fA-F]{6}$/.test(mainColor || '') ? (mainColor as string) : colors.primary;

  // Web window message listener: tangani klik peta dan sinkronisasi iframe
  useEffect(() => {
    if (Platform.OS === 'web') {
      const handleWebMessage = (event: MessageEvent) => {
        try {
          const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
          if (data && data.type === 'MAP_CLICK' && onLocationSelect) {
            onLocationSelect(data.latitude, data.longitude);
          } else if (data && data.type === 'IFRAME_READY' && iframeRef.current?.contentWindow) {
            iframeRef.current.contentWindow.postMessage({
              type: 'UPDATE_COORDS',
              officeLat,
              officeLng,
              radiusMeters,
              interactivePicker,
              mainColor: main,
            }, '*');
          }
        } catch {
          // Ignore
        }
      };

      window.addEventListener('message', handleWebMessage);
      return () => {
        window.removeEventListener('message', handleWebMessage);
      };
    }
  }, [interactivePicker, onLocationSelect, officeLat, officeLng, radiusMeters, main]);

  // Update koordinat target realtime ke Leaflet tanpa reload iframe (mencegah layar peta putih / blank)
  useEffect(() => {
    if (Platform.OS === 'web' && iframeRef.current?.contentWindow) {
      try {
        iframeRef.current.contentWindow.postMessage({
          type: 'UPDATE_COORDS',
          officeLat,
          officeLng,
          radiusMeters,
          interactivePicker,
          mainColor: main,
        }, '*');
      } catch {}
    }
  }, [officeLat, officeLng, radiusMeters, interactivePicker, main]);

  const rawSpots = (offices && offices.length > 0
    ? offices
    : [{ id: 'single', officeName: 'Titik Kantor', latitude: officeLat, longitude: officeLng, radiusMeters }]
  ).map((o) => ({
    id: String(o.id),
    name: o.officeName.replace(/'/g, ''),
    lat: Number(o.latitude),
    lng: Number(o.longitude),
    rad: Number(o.radiusMeters),
    color: /^#[0-9a-fA-F]{6}$/.test((o as any).color || '') ? (o as any).color : colors.primary,
  }));

  // Deteksi duplikasi koordinat agar tidak menumpuk 100% pada titik yang sama
  const coordCounts: Record<string, number> = {};
  const spots = rawSpots.map((s) => {
    const key = `${s.lat.toFixed(6)},${s.lng.toFixed(6)}`;
    const count = coordCounts[key] || 0;
    coordCounts[key] = count + 1;
    if (count > 0) {
      // Sedikit offset mikro (sekitar 3-5 meter) agar dua titik yang belum disetel posisinya tetap terlihat terpisah
      const angle = (count * 2 * Math.PI) / 6;
      return {
        ...s,
        displayLat: Number((s.lat + 0.00004 * Math.sin(angle)).toFixed(6)),
        displayLng: Number((s.lng + 0.00004 * Math.cos(angle)).toFixed(6)),
        isStacked: true,
      };
    }
    return { ...s, displayLat: s.lat, displayLng: s.lng, isStacked: false };
  });

  const spotsJson = JSON.stringify(spots);
  const activeIdJson = JSON.stringify(activeOfficeId ?? null);

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
          html, body, #map { height: 100%; width: 100%; margin: 0; padding: 0; background: #F8FAFC; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
          .leaflet-control-attribution { font-size: 9px !important; background: rgba(255,255,255,0.8) !important; padding: 2px 6px !important; }
          ${interactivePicker ? '' : '.leaflet-control-zoom, .leaflet-control-attribution, #zoom-badge { display: none !important; }'}
          .leaflet-bar { border-radius: 8px !important; box-shadow: 0 2px 6px rgba(15,23,42,0.18) !important; border: 1px solid #E2E8F0 !important; overflow: hidden; }
          .leaflet-bar a { background-color: #FFFFFF !important; color: #1E293B !important; width: 32px !important; height: 32px !important; line-height: 32px !important; font-size: 16px !important; font-weight: bold !important; }
          .leaflet-bar a:hover { background-color: #F1F5F9 !important; }
          
          /* Calibrated Precision Radar Pulse */
          @keyframes radar-pulse {
            0% { transform: scale(0.6); opacity: 0.9; }
            45% { opacity: 0.35; }
            100% { transform: scale(2.4); opacity: 0; }
          }
          @keyframes radar-core {
            0%, 100% { transform: scale(1); filter: drop-shadow(0 2px 4px rgba(15,23,42,0.2)); }
            50% { transform: scale(1.15); filter: drop-shadow(0 2px 8px rgba(0,97,164,0.45)); }
          }
          
          .user-marker-wrapper { background: transparent; border: none; }
          .user-location-marker {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 38px;
            height: 38px;
          }
          .user-location-pulse {
            position: absolute;
            width: 38px;
            height: 38px;
            border-radius: 50%;
            background: rgba(0, 97, 164, 0.28);
            animation: radar-pulse 2.2s cubic-bezier(0.2, 0.6, 0.35, 1) infinite;
            pointer-events: none;
          }
          .user-location-pulse-delayed {
            position: absolute;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            background: rgba(0, 97, 164, 0.2);
            animation: radar-pulse 2.2s cubic-bezier(0.2, 0.6, 0.35, 1) infinite;
            animation-delay: 0.85s;
            pointer-events: none;
          }
          .user-location-core {
            position: relative;
            width: 14px;
            height: 14px;
            border-radius: 50%;
            background: #0061A4;
            border: 2.5px solid #FFFFFF;
            animation: radar-core 2.2s ease-in-out infinite;
            z-index: 2;
          }
          
          /* Target Picker Pin & Navigation Pin */
          .nav-pin-marker-wrap { background: transparent; border: none; }
          .nav-pin-container {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            filter: drop-shadow(0 3px 6px rgba(15, 23, 42, 0.35));
            transition: transform 0.15s ease;
          }
          .nav-pin-container:hover {
            transform: scale(1.08);
          }
          .nav-pin-draggable {
            cursor: grab !important;
          }
          .nav-pin-draggable:active {
            cursor: grabbing !important;
            transform: scale(1.18) translateY(-4px);
          }
          .nav-pin-shadow {
            position: absolute;
            bottom: -2px;
            left: 50%;
            transform: translateX(-50%);
            width: 14px;
            height: 6px;
            border-radius: 50%;
            background: rgba(15, 23, 42, 0.3);
            filter: blur(1.5px);
            pointer-events: none;
          }
          .pin-drag-hint {
            position: absolute;
            top: -24px;
            left: 50%;
            transform: translateX(-50%);
            background: #0F172A;
            color: #FFFFFF;
            font-size: 10px;
            font-weight: 700;
            padding: 2px 7px;
            border-radius: 5px;
            white-space: nowrap;
            pointer-events: none;
            box-shadow: 0 2px 5px rgba(0,0,0,0.3);
          }
          .pin-drag-hint::after {
            content: '';
            position: absolute;
            bottom: -4px;
            left: 50%;
            transform: translateX(-50%);
            border-width: 4px 4px 0;
            border-style: solid;
            border-color: #0F172A transparent transparent transparent;
          }
          .picker-pin-pulse {
            position: absolute;
            bottom: -5px;
            left: 50%;
            transform: translateX(-50%);
            width: 22px;
            height: 22px;
            border-radius: 50%;
            background: rgba(234, 88, 12, 0.35);
            animation: radar-pulse 1.8s ease-out infinite;
            pointer-events: none;
          }
          
          .zoom-hud-badge {
            position: absolute;
            bottom: 12px;
            right: 12px;
            z-index: 1000;
            background: rgba(255, 255, 255, 0.92);
            backdrop-filter: blur(4px);
            padding: 4px 8px;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 700;
            color: #334155;
            border: 1px solid #CBD5E1;
            pointer-events: none;
          }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <div id="zoom-badge" class="zoom-hud-badge">Zoom: 17x</div>
        <script>
          var oLat = Number(${officeLat}) || -7.23707;
          var oLng = Number(${officeLng}) || 112.6346;
          var uLat = Number(${userLat}) || oLat;
          var uLng = Number(${userLng}) || oLng;
          var rad = Number(${radiusMeters}) || 150;
          var spots = ${spotsJson};
          var activeId = ${activeIdJson};
          var mainC = '${main}';
          var isPicker = ${interactivePicker ? 'true' : 'false'};

          // Konfigurasi Peta dengan SUPER-ZOOM (mendukung hingga zoom 21)
          var map = L.map('map', {
            zoomControl: true,
            minZoom: 3,
            maxZoom: 21,
            scrollWheelZoom: true,
            touchZoom: true,
            doubleClickZoom: true
          }).setView([oLat, oLng], 17);

          // Tile layer dengan overscaling (maxNativeZoom 19, maxZoom 21) untuk detail maksimal
          L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
            minZoom: 3,
            maxNativeZoom: 19,
            maxZoom: 21,
            attribution: '&copy; OpenStreetMap contributors'
          }).addTo(map);

          // Update HUD zoom indicator
          var zoomBadge = document.getElementById('zoom-badge');
          map.on('zoomend', function() {
            if (zoomBadge) zoomBadge.innerText = 'Zoom: ' + map.getZoom() + 'x';
          });
          zoomBadge.innerText = 'Zoom: ' + map.getZoom() + 'x';

          // Geofence Circle untuk titik yang sedang aktif / diedit
          var targetCircle = L.circle([oLat, oLng], {
            color: mainC,
            fillColor: mainC,
            fillOpacity: 0.16,
            weight: 2,
            radius: rad
          }).addTo(map);

          // Fungsi Generator Pin Navigasi GPS Modern untuk Titik Kantor
          function createNavPinHtml(color, isDraggable, labelHint) {
            var pinColor = color || '#0061A4';
            var w = isDraggable ? 34 : 28;
            var h = isDraggable ? 44 : 38;
            var pulseHtml = isDraggable ? '<div class="picker-pin-pulse"></div>' : '';
            var hintHtml = labelHint ? '<div class="pin-drag-hint">' + labelHint + '</div>' : '';

            return '<div class="nav-pin-container ' + (isDraggable ? 'nav-pin-draggable' : '') + '">' +
                     hintHtml +
                     pulseHtml +
                     '<div class="nav-pin-shadow"></div>' +
                     '<svg width="' + w + '" height="' + h + '" viewBox="0 0 32 42" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                       '<path d="M16 0C7.163 0 0 7.163 0 16C0 26.5 14.5 40.5 15.3 41.3C15.7 41.7 16.3 41.7 16.7 41.3C17.5 40.5 32 26.5 32 16C32 7.163 24.837 0 16 0Z" fill="' + pinColor + '"/>' +
                       '<circle cx="16" cy="15" r="8.5" fill="#FFFFFF"/>' +
                       '<polygon points="16,9 21,19 16,16.8 11,19" fill="' + pinColor + '"/>' +
                     '</svg>' +
                   '</div>';
          }

          var roundDotHtml = function(color) {
            return '<div style="width:18px;height:18px;border-radius:50%;background:' + color + ';border:2.5px solid #FFFFFF;box-shadow:0 2px 6px rgba(15,23,42,0.35);"></div>';
          };

          function sendLocation(lat, lng) {
            var payload = JSON.stringify({ type: 'MAP_CLICK', latitude: lat, longitude: lng });
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(payload);
            } else if (window.parent) {
              window.parent.postMessage(payload, '*');
            }
          }

          // Marker Target / Titik Kantor Terpilih
          // Selalu gunakan Pin Navigasi GPS modern berbentuk tetesan air (seperti Google Maps)
          var targetIcon = L.divIcon({
            className: 'nav-pin-marker-wrap',
            html: createNavPinHtml(mainC, isPicker, isPicker ? 'Geser / Ketuk Peta' : ''),
            iconSize: [34, 44],
            iconAnchor: [17, 44],
            popupAnchor: [0, -44]
          });

          var targetMarker = L.marker([oLat, oLng], {
            icon: targetIcon,
            draggable: isPicker,
            zIndexOffset: 1000
          }).addTo(map);

          targetMarker.bindPopup("<b>" + (isPicker ? "Titik Kantor (Geser Pin atau Ketuk Peta)" : "Titik Kantor Utama") + "</b>");

          // Fitur Drag & Drop Realtime Titik Lokasi Kantor (Hanya saat mode edit aktif)
          if (isPicker) {
            targetMarker.on('drag', function(e) {
              if (!isPicker) return;
              var pos = e.target.getLatLng();
              targetCircle.setLatLng(pos);
            });

            targetMarker.on('dragend', function(e) {
              if (!isPicker) return;
              var pos = e.target.getLatLng();
              var lat = Number(pos.lat.toFixed(6));
              var lng = Number(pos.lng.toFixed(6));
              targetCircle.setLatLng([lat, lng]);
              sendLocation(lat, lng);
            });
          }

          // RENDER TITIK-TITIK KANTOR LAINNYA
          // KUNCI PERBAIKAN: Jika titik kantor ini adalah titik yang sedang diedit (activeId) ATAU koordinatnya sama persis dengan oLat,oLng,
          // JANGAN dirender lagi agar tidak ada marker ganda yang saling menumpuk!
          try {
            var spotIcon = function(c) {
              return L.divIcon({
                className: 'spot-icon',
                html: '<div style="width:14px;height:14px;border-radius:50%;background:' + c + ';border:2px solid #FFFFFF;box-shadow:0 1px 4px rgba(15,23,42,0.25);"></div>',
                iconSize: [14, 14],
                iconAnchor: [7, 7]
              });
            };

            spots.forEach(function(s) {
              // Jika ini adalah spot yang sedang aktif/diedit, lewati karena posisinya sudah diwakili oleh targetMarker & targetCircle
              var isCurrentTarget = (activeId && s.id === activeId) || (Math.abs(s.lat - oLat) < 0.000005 && Math.abs(s.lng - oLng) < 0.000005);
              if (isCurrentTarget) {
                targetMarker.bindTooltip(s.name, { permanent: false, direction: 'top' });
                return; // STOP! Jangan buat marker kedua di titik yang sama
              }

              var sc = (/^#[0-9a-fA-F]{6}$/.test(s.color || '') ? s.color : '#0061A4');
              var lat = s.displayLat || s.lat;
              var lng = s.displayLng || s.lng;

              // Lingkaran radius spot kantor lain
              L.circle([lat, lng], {
                color: sc,
                fillColor: sc,
                fillOpacity: 0.10,
                weight: 1,
                radius: s.rad || rad,
              }).addTo(map);

              // Marker spot kantor lain (Titik Bulat Bersih)
              var sm = L.marker([lat, lng], { icon: spotIcon(sc) }).addTo(map);
              sm.bindTooltip(s.name + (s.isStacked ? " (Posisi berdekatan)" : ""), { permanent: false, direction: 'top' });
              
              sm.on('click', function() {
                map.flyTo([lat, lng], 19, { animate: true, duration: 0.8 });
              });
            });
          } catch(e) {}

          // User Marker (Animated Pulsing Radar Point)
          var userMarker = null;
          if (!isPicker || (Math.abs(uLat - oLat) > 0.0001 || Math.abs(uLng - oLng) > 0.0001)) {
            var userIcon = L.divIcon({
              className: 'user-marker-wrapper',
              html: '<div class="user-location-marker">' +
                      '<div class="user-location-pulse"></div>' +
                      '<div class="user-location-pulse-delayed"></div>' +
                      '<div class="user-location-core"></div>' +
                    '</div>',
              iconSize: [38, 38],
              iconAnchor: [19, 19],
              popupAnchor: [0, -19]
            });
            userMarker = L.marker([uLat, uLng], { icon: userIcon, zIndexOffset: 500 }).addTo(map);
            userMarker.bindPopup("<b>Posisi Anda Saat Ini</b><br>" + uLat.toFixed(6) + ", " + uLng.toFixed(6));
          }

          // Klik peta hanya boleh memindahkan titik saat mode edit (isPicker) aktif
          map.on('click', function(e) {
            if (!isPicker) return; // KUNCI MATI: Dilarang ubah titik di luar mode edit!
            var lat = Number(e.latlng.lat.toFixed(6));
            var lng = Number(e.latlng.lng.toFixed(6));

            targetMarker.setLatLng([lat, lng]);
            targetCircle.setLatLng([lat, lng]);
            sendLocation(lat, lng);
          });

          // Menerima update koordinat secara mulus tanpa reload iframe (anti-blank putih)
          window.addEventListener('message', function(event) {
            try {
              var d = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
              if (d && d.type === 'UPDATE_COORDS') {
                var nLat = Number(d.officeLat);
                var nLng = Number(d.officeLng);
                var nRad = Number(d.radiusMeters);
                isPicker = !!d.interactivePicker;
                var nColor = d.mainColor || '#0061A4';

                if (targetMarker && targetCircle) {
                  targetMarker.setLatLng([nLat, nLng]);
                  targetCircle.setLatLng([nLat, nLng]);
                  targetCircle.setRadius(nRad);
                  targetCircle.setStyle({ color: nColor, fillColor: nColor });

                  var newIcon = L.divIcon({
                    className: 'nav-pin-marker-wrap',
                    html: createNavPinHtml(nColor, isPicker, isPicker ? 'Geser / Ketuk Peta' : ''),
                    iconSize: [34, 44],
                    iconAnchor: [17, 44],
                    popupAnchor: [0, -44]
                  });
                  targetMarker.setIcon(newIcon);

                  if (isPicker) {
                    targetMarker.dragging.enable();
                  } else {
                    targetMarker.dragging.disable();
                  }
                  map.panTo([nLat, nLng], { animate: true, duration: 0.5 });
                }
              }
            } catch(err) {}
          });

          // Notifikasi iframe siap
          var readyPayload = JSON.stringify({ type: 'IFRAME_READY' });
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(readyPayload);
          } else if (window.parent) {
            window.parent.postMessage(readyPayload, '*');
          }

          setTimeout(function() {
            if (map) map.invalidateSize();
          }, 300);

          // Otomatis fokus kamera yang pintar
          try {
            if (isPicker) {
              // Mode edit admin: fokus langsung ke kantor yang sedang diedit
              map.setView([oLat, oLng], 17);
            } else {
              // Mode absensi karyawan: Selalu pusatkan ke posisi user saat ini di zoom 17!
              map.setView([uLat, uLng], 17);
            }
          } catch(e) {
            map.setView([uLat, uLng], 17);
          }
        </script>
      </body>
    </html>
  `;

  const stableHtml = useMemo(() => htmlContent, [spotsJson, activeIdJson, interactivePicker]);

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.container, { height }]}>
        <iframe
          ref={iframeRef}
          srcDoc={stableHtml}
          style={{ width: '100%', height: '100%', border: 'none', borderRadius: radius.md, backgroundColor: '#F8FAFC' }}
          title="Interactive Map"
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { height }]}>
      <WebView
        originWhitelist={['*']}
        source={{ html: htmlContent }}
        style={{ flex: 1, borderRadius: radius.md }}
        scrollEnabled={false}
        onMessage={(event) => {
          try {
            const data = JSON.parse(event.nativeEvent.data);
            if (data && data.type === 'MAP_CLICK' && onLocationSelect) {
              onLocationSelect(data.latitude, data.longitude);
            }
          } catch {
            // Ignore
          }
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSoft,
  },
});
