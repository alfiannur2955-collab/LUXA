// Posisi matahari sederhana (cukup untuk ilustrasi): deklinasi, persamaan waktu, sudut jam.
// Menghasilkan azimut dari utara searah jarum jam dan elevasi, dalam derajat.
const R = Math.PI / 180;

export function sunPosition({ lat = -6.2, lon = 106.8, tz = 7, month, day, hour }) {
  const n = Math.floor(275 * month / 9) - Math.floor((month + 9) / 12) * (1 + Math.floor((month - 3 + 2) / 3)) + day - 30;
  const decl = 23.44 * Math.sin(R * (360 / 365) * (284 + n));
  const B = R * (360 / 365) * (n - 81);
  const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  const solar = hour + (4 * (lon - 15 * tz) + eot) / 60;
  const H = 15 * (solar - 12);
  const sinEl = Math.sin(R * lat) * Math.sin(R * decl) + Math.cos(R * lat) * Math.cos(R * decl) * Math.cos(R * H);
  const el = Math.asin(sinEl) / R;
  let az = Math.atan2(Math.sin(R * H), Math.cos(R * H) * Math.sin(R * lat) - Math.tan(R * decl) * Math.cos(R * lat)) / R + 180;
  az = (az + 360) % 360;
  return { az, el };
}
