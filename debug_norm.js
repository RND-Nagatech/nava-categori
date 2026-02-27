const fs=require('fs');
const data=JSON.parse(fs.readFileSync('data/faq.json','utf8'));
const normalizeSpaces=s=> (s||'').replace(/\s+/g,' ').trim();
const stripPunct=s=>(s||'').replace(/[\?\.!,:;"'()\[\]{}]/g,'');
const lower=s=>(s||'').toLowerCase();
const canon = s => {
	if(!s) return s;
	return s
		.replace(/\bstock\b/g, 'stok')
		.replace(/\bmargin penjualan\b/g, 'penjualan margin')
		.replace(/\b(untuk|gunanya|kegunaan|buat|fungsi|itu)\b/g, 'fungsi')
		.replace(/\b(reprint|re-print|cetak ulang|mencetak ulang)\b/g, 'reprint')
		.replace(/\b(langkah-langkah|langkah langkah|langkah-langkah|langkah)\b/g, 'cara')
		.replace(/\b(cara)\b/g, 'cara');
};
const norm=s=>canon(normalizeSpaces(stripPunct(lower(s))));
const cat = data.find(k=>k.kategori.toLowerCase()==='penjualan');
const target='selisih laporan tranasaksi penjualan';
console.log('target norm =', norm(target));
const matches = cat.faq.map(f=>({q:f.pertanyaan, n:norm(f.pertanyaan)})).filter(x=>x.n===norm(target));
console.log(JSON.stringify(matches, null, 2));
