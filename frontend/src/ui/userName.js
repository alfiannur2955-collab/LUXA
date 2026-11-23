// Nama panggilan pengguna (disimpan di browser) + kata sapaan menurut jam.
const NAME_KEY = 'luxa.userName.v1';

export function loadUserName() {
  try {
    return window.localStorage.getItem(NAME_KEY);
  } catch {
    return null;
  }
}

export function saveUserName(name) {
  try {
    if (name === null) window.localStorage.removeItem(NAME_KEY);
    else window.localStorage.setItem(NAME_KEY, name);
  } catch {
    // penyimpanan browser tidak tersedia: nama hanya berlaku sampai halaman ditutup
  }
}

/** Nama wajib diisi sebelum masuk Beranda; isian kosong lama (tombol Lewati) dianggap belum ada. */
export function needsUserName() {
  const n = loadUserName();
  return !n || !n.trim();
}

export function greetingWord(d = new Date()) {
  const h = d.getHours();
  if (h >= 4 && h < 11) return 'Selamat pagi';
  if (h >= 11 && h < 15) return 'Selamat siang';
  if (h >= 15 && h < 18) return 'Selamat sore';
  return 'Selamat malam';
}
