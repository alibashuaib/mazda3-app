/* ============================================================
   Repairable — curated "may be repairable instead of replaced" guidance.
   Dual-mode like shops.js. General guidance only, never a diagnosis.
   DRAFT — owner review required before release (all tip wording).
   ============================================================ */
'use strict';

(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const api = factory();
  if (isNode) module.exports = api;
  else root.repairable = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  // DRAFT — owner review required before release.
  const LIST = [
    { id: 'headlight', keywords: ['headlight', 'head light', 'headlamp', 'مصباح أمامي', 'الفانوس الأمامي', 'كشاف'],
      tipEn: 'Cloudy or yellowed headlights can often be restored by polishing, at a fraction of the cost of a new unit.',
      tipAr: 'يمكن في كثير من الأحيان إعادة تلميع المصابيح الأمامية المعتمة أو المصفرّة بتكلفة أقل بكثير من شراء مصباح جديد.' },
    { id: 'windscreen', keywords: ['windscreen', 'windshield', 'زجاج أمامي', 'الزجاج الأمامي'],
      tipEn: 'Small chips can often be filled by a glass repair service before they spread; larger or edge cracks usually need replacement.',
      tipAr: 'يمكن في كثير من الأحيان إصلاح الشظايا الصغيرة قبل أن تتسع؛ أما الشروخ الكبيرة أو عند الحواف فغالبًا تحتاج إلى تبديل.' },
    { id: 'dent', keywords: ['dent', 'door panel', 'bumper', 'صدمة', 'طعجة', 'ظهر الباب', 'صدام'],
      tipEn: 'Shallow dents with intact paint can often be removed by paintless dent repair instead of replacing or repainting a panel.',
      tipAr: 'يمكن في كثير من الأحيان إزالة الطعجات السطحية التي لم يتضرر طلاؤها بدون إعادة صبغ أو تبديل القطعة.' },
    { id: 'alloy', keywords: ['alloy', 'rim', 'wheel refinish', 'جنط', 'جنوط', 'رنج'],
      tipEn: 'Scuffed or lightly bent alloy wheels can often be refinished or straightened for less than the price of a new wheel.',
      tipAr: 'يمكن في كثير من الأحيان إعادة تجديد أو تعديل الجنوط الخفيفة الخدش أو الانحناء بتكلفة أقل من جنط جديد.' },
    // Specific on purpose: a bare 'a/c' would also hit "Cabin (A/C) Filter".
    { id: 'ac', keywords: ['ac compressor', 'a/c compressor', 'a/c gas', 'air conditioning', 'air condition', 'مكيف', 'تكييف', 'كمبروسر'],
      tipEn: 'Weak cooling can sometimes be fixed by a leak check and gas recharge before a compressor is replaced.',
      tipAr: 'قد يُحلّ ضعف التبريد أحيانًا بفحص التسريب وإعادة تعبئة الغاز قبل تبديل الكمبروسر.' },
    { id: 'battery-terminal', keywords: ['battery terminal', 'battery clamp', 'قطب البطارية', 'أقطاب البطارية'],
      tipEn: 'Corroded battery terminals can often be cleaned or re-fitted instead of replacing the battery.',
      tipAr: 'يمكن في كثير من الأحيان تنظيف أقطاب البطارية المتآكلة أو إعادة تركيبها بدل تبديل البطارية.' },
    { id: 'seat-upholstery', keywords: ['seat cover', 'upholstery', 'seat leather', 'تنجيد', 'جلد المقعد', 'فرش'],
      tipEn: 'Worn seat leather or fabric panels can often be repaired or re-covered without replacing the whole seat.',
      tipAr: 'يمكن في كثير من الأحيان إصلاح جلد أو قماش المقعد المتآكل أو إعادة تغطيته دون تبديل المقعد كاملًا.' }
  ];

  // Short ASCII keywords (<= 4 chars, e.g. 'rim', 'dent') match whole words only
  // (optional plural 's'), so "Primary"/"Trim" don't hit 'rim'.
  const hit = (n, k) => {
    k = k.toLowerCase();
    if (/^[a-z]{1,4}$/.test(k)) return new RegExp('(^|[^a-z0-9])' + k + 's?($|[^a-z0-9])').test(n);
    return n.includes(k);
  };

  function tipFor(name) {
    const n = String(name == null ? '' : name).toLowerCase().trim();
    if (!n) return null;
    const e = LIST.find(x => x.keywords.some(k => hit(n, k)));
    return e ? { id: e.id, tipEn: e.tipEn, tipAr: e.tipAr } : null;
  }

  function tip(name, lang) {
    const e = tipFor(name);
    return e ? (lang === 'ar' ? e.tipAr : e.tipEn) : null;
  }

  return { LIST, tipFor, tip };
});
