/** Infer EGX company context (sector / listing) from names — educational heuristics. */

const SECTOR_RULES = [
  {
    id: "banks",
    ar: "بنوك",
    en: "Banks",
    re: /بنك|bank|cib|nbk|qnb|saib|adib|commercial\s+international/i,
  },
  {
    id: "real_estate",
    ar: "عقارات وتطوير",
    en: "Real estate & development",
    re: /عقار|تطوير عقاري|real\s*estate|develop|tmogh|orascom\s+develop|palm|مدينة|اعمار|talaat|hassan\s+allam/i,
  },
  {
    id: "fertilizers",
    ar: "أسمدة وكيماويات",
    en: "Fertilizers & chemicals",
    re: /سماد|أسمدة|fertiliz|كيماو|chemic|ابوقير|افكو/i,
  },
  {
    id: "cement",
    ar: "أسمنت ومواد بناء",
    en: "Cement & building materials",
    re: /أسمنت|اسمنت|cement|بناء|building\s+mat/i,
  },
  {
    id: "energy",
    ar: "بترول وطاقة",
    en: "Oil & energy",
    re: /بترول|نفط|غاز|طاقة|oil|gas|energy|petroleum|أموك|العامرية|egypt\s+oil/i,
  },
  {
    id: "pharma",
    ar: "أدوية ورعاية",
    en: "Pharma & healthcare",
    re: /أدوية|دواء|pharma|health|مستشفى|طبي/i,
  },
  {
    id: "telecom",
    ar: "اتصالات وتكنولوجيا",
    en: "Telecom & tech",
    re: /اتصالات|موبي|فودافون|we\b|telecom|orbit|تكنولوجيا|technolog/i,
  },
  {
    id: "tourism",
    ar: "سياحة وفنادق",
    en: "Tourism & hotels",
    re: /سياح|فندق|hotel|resort|cruise|نقل بحري|shipping/i,
  },
  {
    id: "food",
    ar: "أغذية ومشروبات",
    en: "Food & beverages",
    re: /أغذية|اطعمة|مطع|مطح|سكر|سكرية|دجاج|دواجن|food|beverage|juice|juhayna|domty|edita/i,
  },
  {
    id: "industrials",
    ar: "صناعة وحديد",
    en: "Industrials & steel",
    re: /حديد|صلب|steel|iron|صناع|industri|ألومنيوم|aluminum|نسيج|textile|قطن|cotton/i,
  },
  {
    id: "insurance",
    ar: "تأمين",
    en: "Insurance",
    re: /تأمين|insuranc|تكافل/i,
  },
  {
    id: "financials",
    ar: "خدمات مالية وغير مصرفية",
    en: "Non-bank financials",
    re: /مالية|تمويل|leasing|تأجير|وساطة|broker|holding\s+cap|استثمار|investment|valu|rami/i,
  },
  {
    id: "holding",
    ar: "قابضة ومتنوعة",
    en: "Holdings & diversified",
    re: /قابضة|holding|مجموعة|group/i,
  },
];

function blob(quote) {
  return [quote?.ticker, quote?.nameAr, quote?.nameEn, quote?.name].filter(Boolean).join(" ");
}

// Known sectors for EGX30 constituents — name matching is only the fallback.
const TICKER_SECTORS = {
  ABUK: "fertilizers", MFPC: "fertilizers", SKPC: "fertilizers",
  ADIB: "banks", COMI: "banks",
  BTFH: "financials", CCAP: "financials", HRHO: "financials",
  EMFD: "real_estate", HELI: "real_estate", ORHD: "real_estate", PHDC: "real_estate", TMGH: "real_estate",
  CLHO: "pharma", ISPH: "pharma", RMDA: "pharma",
  EAST: "food", EFID: "food", JUFO: "food",
  EFIH: "telecom", ETEL: "telecom", FWRY: "telecom", RAYA: "telecom",
  ALCN: "industrials", EGAL: "industrials", GBCO: "industrials", ORAS: "industrials",
  AMOC: "energy",
  MCQE: "cement",
  VLMR: "holding", VLMRA: "holding",
};

export function inferSector(quote) {
  const code = String(quote?.ticker || "").toUpperCase().replace(/\.CA$/, "");
  const known = TICKER_SECTORS[code] && SECTOR_RULES.find((r) => r.id === TICKER_SECTORS[code]);
  if (known) return { id: known.id, nameAr: known.ar, nameEn: known.en };
  const text = blob(quote);
  for (const rule of SECTOR_RULES) {
    if (rule.re.test(text)) {
      return { id: rule.id, nameAr: rule.ar, nameEn: rule.en };
    }
  }
  return { id: "other", nameAr: "أخرى / غير مصنّف", nameEn: "Other / unclassified" };
}

export function buildCompanyProfile(quote) {
  const sector = inferSector(quote);
  const currency = quote?.currency || "EGP";
  const usdListed = String(currency).toUpperCase() === "USD";
  const notes = [];
  if (usdListed) {
    notes.push("مدرج بالدولار — حساس لتغيرات سعر الصرف بجانب حركة السهم");
  }
  if (sector.id === "banks") {
    notes.push("قطاع بنوك: راقب أسعار الفائدة والسيولة القطاعية مع الإشارات الفنية");
  }
  if (sector.id === "real_estate") {
    notes.push("عقارات: الحجم والتأكيد عند المقاومات مهمين؛ تجنّب الشراء الممتد بلا حجم");
  }
  if (sector.id === "fertilizers" || sector.id === "energy") {
    notes.push("قطاع حساس للسلع/الطاقة عالمياً — لا تعتمد على مؤشر واحد");
  }
  if (sector.id === "tourism") {
    notes.push("سياحة: موسمية وحساسة للتدفقات — أكد بالسيولة");
  }

  return {
    ticker: quote?.ticker,
    nameAr: quote?.nameAr || quote?.name || "",
    nameEn: quote?.nameEn || quote?.name || "",
    sectorId: sector.id,
    sectorAr: sector.nameAr,
    sectorEn: sector.nameEn,
    currency,
    exchange: quote?.exchange || "EGX",
    usdListed,
    notes,
  };
}
