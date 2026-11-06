// Katalog barang dan jasa dari MTPP Docs (dipakai pada dokumen tanpa harga)
export const CATALOG: { group: string; items: { desc: string; unit: string }[] }[] = [
  {
    group: 'Transformator Distribusi "Trafindo"',
    items: [
      {
        desc: 'Transformator Distribusi "Trafindo"\n100 kVA, 20 kV — 400/231V, 3Ph / 50Hz, Dyn5\nHermetically Sealed · Winding Al-Al · SPLN D3',
        unit: 'Unit',
      },
      {
        desc: 'Transformator Distribusi "Trafindo"\n200 kVA, 20 kV — 400/231V, 3Ph / 50Hz, Dyn5\nHermetically Sealed · Winding Al-Al · SPLN D3',
        unit: 'Unit',
      },
      {
        desc: 'Transformator Distribusi "Trafindo"\n250 kVA, 20 kV — 400/231V, 3Ph / 50Hz, Dyn5\nHermetically Sealed · Winding Al-Al · SPLN D3',
        unit: 'Unit',
      },
      {
        desc: 'Transformator Distribusi "Trafindo"\n400 kVA, 20 kV — 400/231V, 3Ph / 50Hz, Dyn5\nHermetically Sealed · Winding Al-Al · SPLN D3',
        unit: 'Unit',
      },
      {
        desc: 'Transformator Distribusi "Trafindo"\n630 kVA, 20 kV — 400/231V, 3Ph / 50Hz, Dyn5\nType Hermetically Sealed · Winding Al-Al\nC/W: Keramik Bushing, Integrated Safety Device',
        unit: 'Unit',
      },
      {
        desc: 'Transformator Distribusi "Trafindo"\n800 kVA, 20 kV — 400/231V, 3Ph / 50Hz, Dyn5\nType Hermetically Sealed · Winding Al-Al\nC/W: Keramik Bushing, Integrated Safety Device',
        unit: 'Unit',
      },
      {
        desc: 'Transformator Distribusi "Trafindo"\n1000 kVA, 20 kV — 400/231V, 3Ph / 50Hz, Dyn5\nType Hermetically Sealed · Winding Al-Al',
        unit: 'Unit',
      },
      {
        desc: 'Transformator Distribusi "Trafindo"\n1250 kVA, 20 kV — 400/231V, 3Ph / 50Hz, Dyn5\nType Hermetically Sealed · Winding Al-Al',
        unit: 'Unit',
      },
      {
        desc: 'Transformator Distribusi "Trafindo"\n1600 kVA, 20 kV — 400/231V, 3Ph / 50Hz, Dyn5\nType Hermetically Sealed · Winding Al-Al',
        unit: 'Unit',
      },
    ],
  },
  {
    group: 'MV Cubicle "Schneider Electric"',
    items: [
      {
        desc: 'Incoming Cubicle "Schneider Electric"\nType IM Manual 630A, 24 kV, 12.5 kA, 50 Hz\nC/W: DS 630A',
        unit: 'Unit',
      },
      {
        desc: 'Outgoing Cubicle "Schneider Electric"\nType DM1A 630A, 24 kV, 12.5 kA, 50 Hz — Motorized\nC/W: DS 630A, GCB 630A, 3 CT, 3 PT 20kV/√3 // 100/√3, OCR + DGR',
        unit: 'Unit',
      },
      {
        desc: 'Metering Cubicle "Schneider Electric"\nType QM 630A, 24 kV, 12.5 kA, 50 Hz',
        unit: 'Unit',
      },
      {
        desc: 'Sideplate (tutup kanan / kiri cubicle)',
        unit: 'Pcs',
      },
      {
        desc: 'Busbar coupling / interconnection cubicle',
        unit: 'Lot',
      },
    ],
  },
  {
    group: 'Komponen & Aksesoris',
    items: [
      {
        desc: 'Current Transformer (CT) 20 kV',
        unit: 'Pcs',
      },
      {
        desc: 'Potential Transformer (PT) 20 kV / √3 // 100 / √3',
        unit: 'Pcs',
      },
      {
        desc: 'Fuse Cut Out / HRC Fuse 24 kV',
        unit: 'Pcs',
      },
      {
        desc: 'Kabel NYFGbY / N2XSEBY 20 kV',
        unit: 'Meter',
      },
      {
        desc: 'Terminasi kabel 20 kV (Heat Shrink)',
        unit: 'Set',
      },
      {
        desc: 'Lightning Arrester 24 kV',
        unit: 'Pcs',
      },
    ],
  },
  {
    group: 'Jasa',
    items: [
      {
        desc: 'Biaya commissioning & testing',
        unit: 'Lot',
      },
      {
        desc: 'Jasa pemasangan / instalasi',
        unit: 'Lot',
      },
      {
        desc: 'Preventive maintenance transformator (per unit)',
        unit: 'Unit',
      },
      {
        desc: 'Preventive maintenance MV cubicle (per panel)',
        unit: 'Panel',
      },
      {
        desc: 'Pengujian tahanan isolasi & tahanan pentanahan',
        unit: 'Lot',
      },
      {
        desc: 'Purifikasi / penggantian oli transformator',
        unit: 'Unit',
      },
      {
        desc: 'Biaya mobilisasi & transportasi',
        unit: 'Lot',
      },
    ],
  },
];

export const UNITS = ['Unit', 'Pcs', 'Set', 'Lot', 'Panel', 'Meter', 'Roll', 'Kg', 'Liter', 'Hari', 'Orang'];
export const MAINTENANCE_NOTES =
  'Pekerjaan dilaksanakan sesuai prosedur keselamatan kerja (K3) yang berlaku\nHasil pengukuran terlampir merupakan kondisi pada saat pemeriksaan';
