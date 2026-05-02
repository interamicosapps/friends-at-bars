/** Approximate a circle as a lat/lon ring for map overlays (polygon / GeoJSON). */
export function approximateCircleRingWgs84(
  centerLatitude: number,
  centerLongitude: number,
  radiusMeters: number,
  steps = 56
): { latitude: number; longitude: number }[] {
  const ring: { latitude: number; longitude: number }[] = [];
  const R = 6371000;
  const φ1 = (centerLatitude * Math.PI) / 180;
  const λ1 = (centerLongitude * Math.PI) / 180;

  const δ = radiusMeters / R;

  for (let i = 0; i <= steps; i++) {
    const θ = (i / steps) * 2 * Math.PI;
    const sinφ1 = Math.sin(φ1);
    const cosφ1 = Math.cos(φ1);
    const sinδ = Math.sin(δ);
    const cosδ = Math.cos(δ);

    const sinφ2 =
      sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(θ);
    const φ2 = Math.asin(sinφ2);
    const y = Math.sin(θ) * sinδ * cosφ1;
    const x = cosδ - sinφ1 * sinφ2;
    const λ2 = λ1 + Math.atan2(y, x);

    ring.push({
      latitude: (φ2 * 180) / Math.PI,
      longitude: ((λ2 * 180) / Math.PI + 540) % 360 - 180,
    });
  }
  return ring;
}
