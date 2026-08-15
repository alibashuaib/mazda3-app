/* ============================================================
   Garage — 2016 Mazda 3 2.0 SkyActiv-G  ·  vanilla JS SPA
   Data persists in localStorage. Everything is editable in-app.
   ============================================================ */
'use strict';

/* The pre-garage v1 key is read by storage.js (LEGACY_V1_KEY / readLegacyV1)
   and seeded from in hydrate(). Nothing here writes it. */

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const uid = () => Math.random().toString(36).slice(2, 9);
const fmt = n => Number(n).toLocaleString('en-US');
const sar = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const parseDate = s => new Date(s + 'T00:00:00');

/* ============================================================
   i18n — Arabic / English. t() keys on the English string, so any
   string not yet in the dictionary safely falls back to English.
   ============================================================ */
let lang = 'en';
const AR = {
  // nav
  'Dashboard': 'الرئيسية', 'Maintenance': 'الصيانة', 'Parts': 'القطع', 'Fuel': 'الوقود', 'Budget': 'الميزانية', 'Reports': 'التقارير',
  // statuses / pills
  'Overdue': 'متأخرة', 'Due soon': 'قريبة الاستحقاق', 'On track': 'على المسار', 'Active': 'الحالية', 'Switch ›': 'تبديل ›',
  // dashboard tiles / labels
  'SAR this year': 'ريال هذا العام', 'Health': 'الحالة', 'km left': 'كم متبقية', 'km over': 'كم تجاوز',
  // page intros
  'Your service schedule and full work history — tracked by distance and time.': 'جدول الصيانة وسجل الأعمال الكامل — حسب المسافة والوقت.',
  'Car Parts': 'قطع السيارة', 'OEM parts with cheaper alternatives, prices and where to buy. Tap a part to compare.': 'قطع أصلية مع بدائل أرخص، الأسعار وأماكن الشراء. اضغط على قطعة للمقارنة.',
  'Log fill-ups to track economy (L/100 km) and running cost.': 'سجّل التعبئة لتتبع الاستهلاك (ل/100كم) وتكلفة التشغيل.',
  'Budget & Spending': 'الميزانية والمصروفات', 'Track what your Mazda costs to run and keep it in top shape.': 'تابع تكلفة تشغيل سيارتك وحافظ عليها بأفضل حال.',
  'Generate a clean, printable A4 report — then Print or Save as PDF.': 'أنشئ تقرير A4 واضح للطباعة — ثم اطبعه أو احفظه PDF.',
  // section titles + links
  'Next up': 'التالي', 'Recommendations': 'التوصيات', 'Documents & renewals': 'الوثائق والتجديدات', 'Monthly spending': 'المصروف الشهري',
  'Recent spending': 'أحدث المصروفات', 'Fill-up log': 'سجل التعبئة', 'Economy trend — L/100km (lower is better)': 'اتجاه الاستهلاك — ل/100كم (الأقل أفضل)',
  'Schedule': 'الجدول', 'History': 'السجل', 'See all': 'عرض الكل', 'Add': 'إضافة', 'More': 'المزيد', 'Work history': 'سجل الأعمال',
  // schedule basis (severe vs dealer)
  'Jeddah (severe)': 'جدة (مكثّف)', 'Dealer (normal)': 'الوكيل (عادي)', 'dealer': 'الوكيل', 'severe': 'مكثّف',
  'Dealer interval (km)': 'فترة الوكيل (كم)', 'Dealer interval (mo)': 'فترة الوكيل (شهر)', 'same as above': 'كما بالأعلى',
  // community gearbox (ATF) parts + note
  'Transmission Fluid Filter': 'فلتر زيت القير', 'Transmission Pan Sealant': 'غراء كارتر القير (سيليكون)',
  'Community rec. (Mazda CX-5 group + info guide): renew ATF every 60–80k km per gearbox condition. Mazda Genuine ATF-FZ only (K020-W0-052E4), ~4.5–4.7 L per drain — buy 5×1 L. Replace the pan filter (FZ01-21-500) and reseal the pan with silicone (Dirko HT / Reinzosil / Mopar — better than dealer sealant), applied cleanly. Go easy on the gearbox for the first ~800 km. Check the fluid level to spec. No additives.': 'توصية المجتمع (قروب مازدا CX-5 + دليل المعلومات): جدّد زيت القير كل 60–80 ألف كم حسب حالة القير. زيت مازدا الأصلي ATF-FZ فقط (K020-W0-052E4)، ~4.5–4.7 لتر لكل تغيير — اشترِ 5×1 لتر. استبدل فلتر الكارتر (FZ01-21-500) وأعد غلق الكارتر بالسيليكون (Dirko HT / Reinzosil / Mopar — أفضل من غراء الوكالة) بطريقة نظيفة. لا تُجهد القير أول ~800 كم. تأكد من معيار الزيت. لا تستخدم معالجات.',
  // milestone plan
  'Plan': 'الخطة', 'Major service': 'صيانة رئيسية', 'mo': 'شهر', 'yr': 'سنة', 'Next up': 'التالي',
  'What’s coming up, built from your own services and when each was last done. Tap a task to log it, or log a whole visit.': 'ما هو قادم، مبني من خدماتك ومتى أُجريت كل منها آخر مرة. اضغط على مهمة لتسجيلها، أو سجّل زيارة كاملة.',
  'Log this visit': 'سجّل هذه الزيارة', 'Visit logged ✓': 'تم تسجيل الزيارة ✓', 'Service visit': 'زيارة صيانة',
  'Show later years': 'عرض السنوات القادمة', 'Nothing scheduled — you’re all caught up!': 'لا شيء مجدول — أنت محدّث بالكامل!',
  'This adapts to when you actually service the car — log a task off its usual interval and the plan re-times itself. Edit intervals under Schedule.': 'يتكيّف هذا مع وقت صيانتك الفعلي للسيارة — سجّل مهمة خارج فترتها المعتادة وتعيد الخطة ضبط توقيتها. عدّل الفترات من الجدول.',
  // first-time plan setup — step-by-step wizard
  'Set up your plan': 'إعداد خطتك', 'Set up': 'إعداد', 'e.g. 316,000': 'مثال: 316,000',
  'Tell the plan which major services you’ve already done.': 'أخبر الخطة بالخدمات الرئيسية التي أنجزتها.',
  'Update your plan': 'تحديث خطتك', 'Re-answer the setup questions if anything’s changed.': 'أعد الإجابة على أسئلة الإعداد إذا تغيّر أي شيء.',
  'No services in your list yet.\nAdd some under Schedule first.': 'لا توجد خدمات في قائمتك بعد.\nأضف بعضها من الجدول أولاً.',
  'km': 'كم', 'Step': 'خطوة', 'of': 'من', 'Back': 'رجوع', 'Next': 'التالي', 'Finish': 'إنهاء',
  'Which schedule fits your car?': 'ما الجدول الأنسب لسيارتك؟',
  'Jeddah heat & dust call for shorter intervals; the dealer sheet is the standard Mazda schedule.': 'حرارة وغبار جدة يتطلبان فترات أقصر؛ جدول الوكيل هو الجدول القياسي لمازدا.',
  'Current odometer': 'عداد السيارة الحالي', 'Keeps every due date and estimate accurate.': 'يحافظ على دقة كل تاريخ استحقاق وتقدير.',
  'How much do you drive?': 'كم تقود يومياً؟',
  'Used to turn km into calendar dates, and to adjust the plan to your driving style — a rough average is fine.': 'يُستخدم لتحويل الكيلومترات إلى تواريخ، ولتكييف الخطة مع أسلوب قيادتك — تقدير تقريبي يكفي.',
  'Per day': 'باليوم', 'Per month': 'بالشهر', 'Average km': 'متوسط الكيلومترات', 'e.g. 40': 'مثال: 40',
  'Enter your average driving distance': 'أدخل متوسط مسافة القيادة',
  'Have you had this done?': 'هل أُنجزت هذه الخدمة من قبل؟', 'Yes, done': 'نعم، أُنجزت', 'Not sure / skip': 'غير متأكد / تخطّي',
  'At what km (roughly)?': 'عند أي كم تقريباً؟', 'Enter your current odometer': 'أدخل عداد سيارتك الحالي',
  'Enter a km for this service': 'أدخل قراءة الكم لهذه الخدمة',
  'Skip for now': 'تخطّي الآن', 'Plan updated': 'تم تحديث الخطة',
  // tiles (fuel / history / budget)
  'Last L/100km': 'آخر ل/100كم', 'Avg L/100km': 'متوسط ل/100كم', 'SAR / km': 'ريال/كم', 'Services logged': 'خدمات مسجلة',
  'SAR total': 'إجمالي الريال', 'Last service': 'آخر خدمة', 'OF BUDGET': 'من الميزانية', 'of budget': 'من الميزانية', 'Spent in 2026': 'المصروف في 2026',
  // filters / segments
  'All': 'الكل', 'OK': 'سليمة',
  // buttons
  'Log a service': 'تسجيل خدمة', 'Add spending': 'إضافة مصروف', 'Add fill-up': 'إضافة تعبئة', 'Mark done now': 'تحديد كمنجز',
  'A single service, or a whole plan visit at once.': 'خدمة واحدة، أو زيارة خطة كاملة دفعة واحدة.',
  'Single service': 'خدمة واحدة', 'Pick one thing you just had done.': 'اختر شيئاً واحداً أنجزته للتو.', 'Choose': 'اختيار',
  'Plan visit': 'زيارة الخطة', 'A group of services from your plan, done together.': 'مجموعة خدمات من خطتك، أُنجزت معاً.',
  'Log a plan visit': 'تسجيل زيارة الخطة', 'Pick an upcoming group of services — logs everything in it at once.': 'اختر مجموعة خدمات قادمة — يسجّل كل ما فيها دفعة واحدة.',
  'Log it': 'سجّلها', 'No linked parts': 'لا توجد قطع مرتبطة',
  'Pick the parts you used (OEM or alternative), then log it.': 'اختر القطع التي استخدمتها (أصلية أو بديلة)، ثم سجّلها.',
  'Done': 'تمّت', 'Not yet': 'ليس بعد', 'Carried to your next visit': 'مُرحّلة إلى زيارتك القادمة',
  // add-vehicle picker
  'Add a Mazda': 'إضافة مازدا', 'Pick the model and engine — its SkyActiv service plan is set up for you.': 'اختر الطراز والمحرك — تُجهّز خطة صيانة SkyActiv تلقائياً.',
  'Vehicle added': 'تمت إضافة المركبة', 'e.g. 2019': 'مثال: 2019',
  'None — not done': 'لا شيء — لم تُنفّذ', 'Skipped last time — do it now': 'تُخطّيت آخر مرة — نفّذها الآن', 'Do next service': 'نفّذها في الخدمة القادمة',
  'part(s) to redo next service': 'قطعة لإعادتها في الخدمة القادمة', 'mandatory': 'إلزامية', 'optional': 'اختيارية', 'recommended': 'مُستحسنة',
  'logged': 'مسجّلة', 'carried forward': 'مُرحّلة', 'Skipped — do it': 'متخطّاة — نفّذها',
  'service to catch up': 'خدمة بحاجة للإنجاز', 'services to catch up': 'خدمات بحاجة للإنجاز', 'Catch up': 'إنجاز المتأخّر',
  'Log ›': 'تسجيل ›',
  'Edit': 'تعديل', 'Save': 'حفظ', 'Add a part': 'إضافة قطعة', 'Add a custom service': 'إضافة خدمة مخصصة', 'Print / Save PDF': 'طباعة / حفظ PDF',
  'Update mileage': 'تحديث العداد', 'Set annual budget': 'تعيين الميزانية السنوية', 'Add a vehicle': 'إضافة مركبة', 'Add option': 'إضافة خيار',
  'Log a past service': 'تسجيل خدمة سابقة', 'Add to history': 'إضافة للسجل', 'Save changes': 'حفظ التغييرات', 'Save profile': 'حفظ الملف',
  'Save part': 'حفظ القطعة', 'Remove': 'إزالة', 'Remove this vehicle': 'إزالة هذه المركبة', 'Delete': 'حذف',
  // report types
  'Service history': 'سجل الصيانة', 'Purchases': 'المشتريات', 'Full summary': 'ملخص كامل',
  // built-in service names
  'Engine Oil & Filter': 'زيت المحرك والفلتر', 'Fuel System Cleaner': 'منظف نظام الوقود', 'Tire Rotation & Balance': 'تدوير وموازنة الإطارات', 'Cabin (A/C) Filter': 'فلتر المكيف (المقصورة)',
  'Engine Air Filter': 'فلتر هواء المحرك', 'Wheel Alignment': 'ضبط زوايا العجلات', 'Brake Fluid': 'زيت الفرامل',
  'Automatic Transmission Fluid': 'زيت ناقل الحركة الأوتوماتيكي', 'Engine Coolant (FL22)': 'سائل تبريد المحرك (FL22)',
  'Throttle Body & MAF Cleaning': 'تنظيف بوابة الخانق وحساس الهواء', 'Spark Plugs (x4)': 'بواجي الإشعال (×4)', 'Fuel Filter': 'فلتر الوقود',
  'Drive (Serpentine) Belt': 'سير الإدارة', 'Battery Check': 'فحص البطارية', 'Brake Inspection & Caliper Lube': 'فحص الفرامل وتزييت الكاليبر',
  'Suspension & Steering Inspection': 'فحص التعليق والتوجيه',
  // care tips
  'Oil every ~7,500 km': 'الزيت كل ~7,500 كم', 'Tire pressure 36 PSI': 'ضغط الإطارات 36 رطل', 'Battery every 2–3 years': 'البطارية كل 2–3 سنوات', 'Wash the underbody': 'اغسل أسفل السيارة',
  // categories
  'Engine': 'المحرك', 'Interior': 'الداخلية', 'Brakes': 'الفرامل', 'Exterior': 'الخارجية', 'Electrical': 'الكهرباء',
  'Drivetrain': 'نقل الحركة', 'Suspension': 'التعليق', 'A/C': 'التكييف', 'Tires': 'الإطارات', 'General': 'عام',
  // spending categories / doc types
  'Insurance': 'التأمين', 'Registration (Istimara)': 'الاستمارة', 'Vehicle Inspection (Fahes)': 'الفحص الدوري',
  'Driving License': 'رخصة القيادة', 'Warranty': 'الضمان', 'Other': 'أخرى',
  // modal titles / subs
  'Your garage': 'مرآبك', 'Switch between your vehicles or add another.': 'بدّل بين مركباتك أو أضف أخرى.',
  'Car profile': 'ملف السيارة', 'Add fill-up ': 'إضافة تعبئة', 'Edit fill-up': 'تعديل التعبئة', 'Add document': 'إضافة وثيقة', 'Edit document': 'تعديل الوثيقة',
  'Add spending ': 'إضافة مصروف', 'Edit expense': 'تعديل المصروف', 'Log a service ': 'تسجيل خدمة', 'Annual budget': 'الميزانية السنوية',
  // common field labels
  'Date': 'التاريخ', 'Odometer (km)': 'العداد (كم)', 'Litres': 'اللترات', 'Cost (SAR)': 'التكلفة (ريال)', 'Category': 'الفئة',
  'Note': 'ملاحظة', 'Description': 'الوصف', 'Amount (SAR)': 'المبلغ (ريال)', 'Make': 'الصنع', 'Model': 'الطراز', 'Year': 'السنة',
  'Color': 'اللون', 'Transmission': 'ناقل الحركة', 'Plate number': 'رقم اللوحة', 'Type': 'النوع', 'Tank': 'الخزان',
  'Receipt / invoice': 'الإيصال / الفاتورة', 'Nickname (optional)': 'الاسم المختصر (اختياري)', 'Expiry date': 'تاريخ الانتهاء',
  'Budget (SAR / year)': 'الميزانية (ريال / سنة)', 'Full tank': 'خزان ممتلئ', 'Partial fill': 'تعبئة جزئية', 'Add receipt photo': 'إضافة صورة إيصال',
  // parts-page chrome
  'from': 'من', 'options': 'خيارات', '🔧 Used in:': '🔧 مستخدمة في:',
  '🔎 Live price &amp; alternatives on PartSouq ↗': '🔎 السعر والبدائل المباشرة على PartSouq ↗',
  // service-detail rows
  'Interval': 'الفترة', 'Last done': 'آخر مرة', 'Next due': 'الاستحقاق التالي',
  // budget ring
  'over budget': 'فوق الميزانية', 'SAR remaining of': 'ريال متبقية من',
  // report internals
  'Total spent (SAR)': 'إجمالي المصروف (ريال)', 'Total': 'الإجمالي', 'Service': 'الخدمة', 'Odometer': 'العداد',
  'Cost': 'التكلفة', 'Notes': 'ملاحظات', 'Everything is up to date 🎉': 'كل شيء محدّث 🎉', 'Spent in 2026 (SAR)': 'المصروف في 2026 (ريال)',
  'Generated': 'أُنشئ في', 'Odometer ': 'العداد ', 'Current odometer (km)': 'العداد الحالي (كم)', 'No service history recorded yet.': 'لا يوجد سجل صيانة بعد.',
  'Service History Report': 'تقرير سجل الصيانة', 'No purchases or spending recorded yet.': 'لا توجد مشتريات أو مصروفات بعد.', 'Entries': 'إدخالات', 'Categories': 'الفئات',
  'By category': 'حسب الفئة', 'Amount': 'المبلغ', 'Share': 'النسبة', 'All purchases': 'كل المشتريات', 'Item': 'البند', 'Purchases & Spending Report': 'تقرير المشتريات والمصروفات',
  'Health score': 'درجة الحالة', 'Lifetime service cost': 'تكلفة الصيانة الإجمالية', 'Upcoming &amp; overdue services': 'الخدمات القادمة والمتأخرة',
  'Status': 'الحالة', 'Distance': 'المسافة', 'Est. cost': 'التكلفة التقديرية', 'Estimated total': 'الإجمالي التقديري', 'Vehicle Summary Report': 'تقرير ملخص المركبة',
  'Garage · Mazda 3 care app': 'Garage · تطبيق العناية بمازدا 3', 'Report generated': 'صدر التقرير',
  // part names
  'Engine Oil 5W-30 (4L)': 'زيت محرك 5W-30 (4 لتر)', 'Oil Filter': 'فلتر الزيت', 'Fuel System Cleaner (additive)': 'منظف نظام الوقود (إضافة)', 'Cabin A/C Filter': 'فلتر مكيف المقصورة',
  'Spark Plugs (each)': 'بواجي الإشعال (للحبة)', 'Front Brake Pads': 'فحمات الفرامل الأمامية', 'Rear Brake Pads': 'فحمات الفرامل الخلفية',
  'Wiper Blades (pair)': 'مساحات الزجاج (زوج)', '12V Battery': 'بطارية 12 فولت', 'Serpentine Belt': 'سير المولد (السربنتين)',
  'Coolant FL22 (long-life)': 'سائل تبريد FL22 (طويل العمر)', 'ATF FZ (per liter)': 'زيت ناقل ATF FZ (للتر)', 'Brake Fluid (DOT 4)': 'زيت فرامل (DOT 4)',
  'Windshield Washer Fluid (~2L)': 'سائل غسيل الزجاج (~2 لتر)', 'Front Shock Absorber (each)': 'مساعد أمامي (للحبة)',
  'Rear Shock Absorber (each)': 'مساعد خلفي (للحبة)', 'Front Lower Control Arm (each)': 'مقص أمامي سفلي (للحبة)',
  'Front Strut Mount Bearing (each)': 'رمان بلي حاملة المساعد الأمامي (للحبة)', 'Rear Wheel Hub Bearing (each)': 'رمان بلي عجلة خلفية (للحبة)',
  'Stabilizer (Sway Bar) Link': 'وصلة موازن (الاستبلايزر)', 'Ignition Coil (each)': 'بوبينة إشعال (للحبة)', 'Alternator': 'الدينمو (المولد)',
  'Starter Motor': 'السلف (محرك البدء)', 'Front Brake Disc (each)': 'ديسك فرامل أمامي (للحبة)', 'Rear Brake Disc (each)': 'ديسك فرامل خلفي (للحبة)',
  'Water Pump': 'طرمبة الماء', 'Thermostat': 'الثرموستات', 'A/F (Oxygen) Sensor — upstream': 'حساس الأكسجين — أمامي',
  'Front CV Axle Joint (outer)': 'جوزة عكس أمامية (خارجية)', 'MAF (Mass Air Flow) Sensor': 'حساس تدفق الهواء (MAF)',
  'A/C Condenser': 'مكثف التكييف (الكندنسر)', 'Front Coil Spring (each)': 'ياي أمامي (للحبة)', 'Front Wheel Hub Bearing (each)': 'رمان بلي عجلة أمامية (للحبة)',
  'Radiator': 'الردياتير', 'Engine Mount (No.4, right)': 'كرسي محرك (رقم 4، يمين)', 'Front Brake Caliper (each)': 'كاليبر فرامل أمامي (للحبة)',
  'Blower Motor (A/C fan)': 'مروحة المكيف (البلور)', 'Headlight Unit (each)': 'وحدة المصباح الأمامي (للحبة)', 'A/C Compressor': 'كمبروسر التكييف',
  'Rear Coil Spring (each)': 'ياي خلفي (للحبة)', 'Valve Cover Gasket': 'جوان غطاء الصمامات', 'PCV Valve': 'صمام PCV',
  'Crankshaft Position Sensor': 'حساس عمود الكرنك', 'Camshaft Position Sensor': 'حساس عمود الكامات', 'Oxygen Sensor — downstream (rear)': 'حساس الأكسجين — خلفي',
  'Fuel Pump Assembly (in-tank)': 'طرمبة البنزين (داخل الخزان)', 'Drive Belt Tensioner': 'شداد السير', 'Front Engine Mount': 'كرسي محرك أمامي',
  'Transmission Mount': 'كرسي ناقل الحركة', 'Brake Master Cylinder': 'علبة الفرامل الرئيسية', 'Rear Brake Caliper (each)': 'كاليبر فرامل خلفي (للحبة)',
  'Outer Tie Rod End (each)': 'طرف عرق ربط خارجي (للحبة)', 'Headlight Bulbs (H11 low · 9005 high)': 'لمبات المصابيح الأمامية (H11 منخفض · 9005 عالي)',
  'Timing Chain Kit': 'طقم جنزير التوقيت', 'Radiator Hoses (upper & lower)': 'خراطيم الردياتير (علوي وسفلي)',
  'Oil Drain Plug Gasket (14mm crush washer)': 'جوان صامولة تصريف الزيت (وردة 14مم)', 'Front Sway Bar Bushing': 'جلبة موازن أمامي',
  'Blower Motor Resistor': 'مقاومة مروحة المكيف', 'Tail / Brake Light Bulbs': 'لمبات الفرامل / الخلفية',
  'EVAP Purge Valve (canister solenoid)': 'صمام تنقية بخار الوقود (EVAP)', 'Knock Sensor': 'حساس الطرق (النوكينج)',
  'Front CV Axle (complete, each)': 'عكس أمامي كامل (للحبة)', 'Front ABS Wheel Speed Sensor': 'حساس سرعة عجلة ABS أمامي',
  'Engine Coolant Temp Sensor (ECT)': 'حساس حرارة الماء (ECT)', 'Intake Manifold Gasket': 'جوان مجمع السحب',
  // dashboard chrome
  'Odometer': 'العداد', 'Change car photo': 'تغيير صورة السيارة', 'Add a photo of your car': 'أضف صورة لسيارتك',
  'No documents yet.\nAdd insurance, Istimara or license expiry.': 'لا توجد وثائق بعد.\nأضف تاريخ انتهاء التأمين أو الاستمارة أو الرخصة.',
  // maintenance chrome
  'Nothing here — all good!': 'لا شيء هنا — كل شيء بخير!', 'No service history yet.\nLog your first one above.': 'لا يوجد سجل صيانة بعد.\nسجّل أول خدمة بالأعلى.',
  // budget chrome
  'Upcoming maintenance': 'صيانة قادمة', 'View ›': 'عرض ›', 'services due': 'خدمة مستحقة', 'overdue': 'متأخرة', 'plan ~': 'خطط لـ ~',
  'By category (2026)': 'حسب الفئة (2026)', 'No spending logged yet.': 'لا توجد مصروفات مسجلة بعد.',
  // fuel chrome
  'Fuel economy has dropped': 'انخفض توفير الوقود', 'partial': 'جزئي',
  'Last fill-up was': 'كانت آخر تعبئة', 'vs your': 'مقابل متوسطك', 'average.': 'المتوسط.',
  'Common causes: low tire pressure (keep 36 PSI), dirty air filter, worn MAF/O2 sensor, tired spark plugs, or a dragging brake.': 'الأسباب الشائعة: ضغط إطارات منخفض (حافظ على 36 رطل)، فلتر هواء متسخ، حساس هواء/أكسجين مستهلك، بواجي ضعيفة، أو فرامل عالقة.',
  'No fill-ups logged yet.\nTap "Add fill-up" after your next refuel.': 'لا توجد تعبئات مسجلة بعد.\nاضغط "إضافة تعبئة" بعد التعبئة القادمة.',
  // service detail
  'Distance left': 'المسافة المتبقية', 'Parts for this service': 'قطع هذه الخدمة',
  // garage / vehicle names
  'Vehicle': 'مركبة', 'My car': 'سيارتي', 'Select colour': 'اختر اللون',
  // modal subs
  'Record a refuel to track economy & cost.': 'سجّل التعبئة لتتبع الاستهلاك والتكلفة.',
  'Track renewals so you never miss an expiry.': 'تابع التجديدات حتى لا يفوتك أي انتهاء.',
  'Keep this current so due dates stay accurate.': 'حدّثه باستمرار لتبقى مواعيد الاستحقاق دقيقة.',
  'These details personalise the app and its badge.': 'هذه التفاصيل تخصص التطبيق وشعاره.',
  'Your target spend on the car for the year.': 'هدف إنفاقك على السيارة خلال العام.',
  'Record work already done on your car.': 'سجّل عملاً تم إنجازه على سيارتك.',
  'Set the interval and last service point.': 'حدد الفترة وآخر نقطة صيانة.',
  'Pick what you just had done — it resets the clock and adds the cost.': 'اختر ما تم إنجازه — يعيد ضبط العداد ويضيف التكلفة.',
  'Log money spent on the car.': 'سجّل المال المصروف على السيارة.',
  'Add the OEM option and any alternatives.': 'أضف الخيار الأصلي وأي بدائل.',
  // modal titles
  'Edit service record': 'تعديل سجل الخدمة', 'Edit service': 'تعديل الخدمة', 'New service': 'خدمة جديدة',
  'Edit part': 'تعديل القطعة', 'New part': 'قطعة جديدة',
  // field labels
  'Average driving (km / day)': 'متوسط القيادة (كم/يوم)', 'Label (optional)': 'التسمية (اختياري)', 'Reference no. (optional)': 'رقم المرجع (اختياري)',
  'Icon (emoji)': 'الأيقونة (إيموجي)', 'Name': 'الاسم', 'Interval (km)': 'الفترة (كم)', 'Interval (months)': 'الفترة (أشهر)',
  'Last done (km)': 'آخر مرة (كم)', 'Last done (date)': 'آخر مرة (تاريخ)', 'Est. cost (SAR)': 'التكلفة التقديرية (ريال)',
  'Odometer at time (km)': 'العداد وقتها (كم)', 'Part name': 'اسم القطعة',
  'PartSouq part no. (optional — enables live-price link)': 'رقم قطعة PartSouq (اختياري — يفعّل رابط السعر المباشر)',
  'Quick pick <span class="muted" style="font-weight:500">— autofill from a part</span>': 'اختيار سريع <span class="muted" style="font-weight:500">— تعبئة تلقائية من قطعة</span>',
  'Price (SAR)': 'السعر (ريال)', 'Brand / product': 'الماركة / المنتج', 'Part no.': 'رقم القطعة', 'Store': 'المتجر',
  'Options': 'الخيارات', 'Options (OEM & alternatives)': 'الخيارات (الأصلي والبدائل)', 'Also add this cost to Budget': 'أضف هذه التكلفة إلى الميزانية أيضاً',
  // select options / pickers
  'Automatic': 'أوتوماتيك', 'Manual': 'عادي (مانيوال)', 'Start from scratch…': 'ابدأ من الصفر…',
  'Change receipt': 'تغيير الإيصال', 'Change photo': 'تغيير الصورة', 'Add photo': 'إضافة صورة',
  // buttons
  'Save service': 'حفظ الخدمة', 'Delete fill-up': 'حذف التعبئة', 'Delete document': 'حذف الوثيقة', 'Delete record': 'حذف السجل',
  'Delete service': 'حذف الخدمة', 'Delete expense': 'حذف المصروف', 'Delete part': 'حذف القطعة', 'Remove option': 'حذف الخيار',
  // toasts
  'Keep at least one vehicle': 'احتفظ بمركبة واحدة على الأقل', 'Vehicle removed': 'تمت إزالة المركبة',
  'Fill-up updated': 'تم تحديث التعبئة', 'Fill-up added': 'تمت إضافة التعبئة', 'Fill-up deleted': 'تم حذف التعبئة',
  'Litres required': 'اللترات مطلوبة', 'Odometer required': 'العداد مطلوب',
  'Document updated': 'تم تحديث الوثيقة', 'Document added': 'تمت إضافة الوثيقة', 'Document deleted': 'تم حذف الوثيقة',
  'Mileage updated': 'تم تحديث العداد', 'Could not read that image': 'تعذّر قراءة الصورة', 'Profile saved': 'تم حفظ الملف', 'Budget updated': 'تم تحديث الميزانية',
  'Service name required': 'اسم الخدمة مطلوب', 'Record updated': 'تم تحديث السجل', 'Service logged ✓': 'تم تسجيل الخدمة ✓', 'Record deleted': 'تم حذف السجل',
  'Name is required': 'الاسم مطلوب', 'Service updated': 'تم تحديث الخدمة', 'Service added': 'تمت إضافة الخدمة', 'Service deleted': 'تم حذف الخدمة',
  'Description required': 'الوصف مطلوب', 'Amount required': 'المبلغ مطلوب', 'Expense updated': 'تم تحديث المصروف', 'Expense added': 'تمت إضافة المصروف', 'Expense deleted': 'تم حذف المصروف',
  'Part name required': 'اسم القطعة مطلوب', 'Add at least one option': 'أضف خياراً واحداً على الأقل', 'Part updated': 'تم تحديث القطعة', 'Part added': 'تمت إضافة القطعة', 'Part deleted': 'تم حذف القطعة',
  'logged ✓': 'تم تسجيلها ✓',
  // date/status helpers
  'today': 'اليوم', 'No date set': 'لا يوجد تاريخ', 'Due today': 'تنتهي اليوم', 'No expiry date': 'لا يوجد تاريخ انتهاء', 'Expires': 'تنتهي في',
  // placeholders
  'e.g. 42': 'مثال: 42', 'e.g. 95': 'مثال: 95', 'e.g. The Gray Ghost': 'مثال: الشبح الرمادي', 'e.g. Tawuniya comprehensive': 'مثال: التعاونية شامل',
  'e.g. New front brake pads': 'مثال: فحمات فرامل أمامية جديدة', 'e.g. Timing chain inspection': 'مثال: فحص جنزير التوقيت',
  'e.g. Timing chain check': 'مثال: فحص جنزير التوقيت', 'e.g. Front Brake Pads': 'مثال: فحمات الفرامل الأمامية',
  'e.g. ABC 1234': 'مثال: أ ب ج 1234', '17-char VIN': 'رقم هيكل من 17 خانة',
  // service notes — engine, fluids & major intervals
  '5W-30 (API SP / ILSAC GF-6A) full synthetic — 4.2 L with filter, 4.0 L without. Every 7,500 km / 6 mo for Jeddah heat, dust & city driving.': 'زيت 5W-30 اصطناعي بالكامل (API SP / ILSAC GF-6A) — 4.2 لتر مع الفلتر، 4.0 لتر بدونه. كل 7,500 كم / 6 أشهر لحرارة وغبار جدة والقيادة داخل المدينة.',
  'Added to the tank at every oil change (dealer sheet) — keeps injectors and intake valves clean against Jeddah\'s dust and short city trips.': 'يُضاف إلى خزان الوقود عند كل تغيير زيت (حسب جدول الوكيل) — يحافظ على نظافة الحاقنات وصمامات السحب من غبار جدة والرحلات القصيرة داخل المدينة.',
  'Rotate front/rear and rebalance to even out wear.': 'بدّل مواضع الإطارات الأمامية/الخلفية وأعد الموازنة لتوزيع التآكل بالتساوي.',
  'Jeddah dust clogs it fast — replace ~yearly / 15,000 km; check before summer A/C season.': 'غبار جدة يسدّه بسرعة — استبدله كل ~سنة / 15,000 كم؛ افحصه قبل موسم التكييف الصيفي.',
  'Inspect earlier in sandy conditions.': 'افحصه مبكراً في الأجواء الرملية.',
  'Also after any pothole hit or new tires.': 'أيضاً بعد الاصطدام بحفرة أو تركيب إطارات جديدة.',
  'DOT 3/4 (~1 L). Absorbs moisture over time — flush every 2 years.': 'DOT 3/4 (~1 لتر). يمتص الرطوبة مع الوقت — اسحبه (فلاش) كل سنتين.',
  'Mazda Genuine ATF-FZ only — ~3.5 L per drain (7.8 L total). Every 60–80k km; dealer or specialist.': 'زيت مازدا الأصلي ATF-FZ فقط — ~3.5 لتر لكل تصريف (7.8 لتر إجمالاً). كل 60–80 ألف كم؛ لدى الوكيل أو متخصص.',
  'Mazda FL22 long-life (HOAT), ~6.6 L. Replace every 5 years in KSA heat.': 'مازدا FL22 طويل العمر (HOAT)، ~6.6 لتر. استبدله كل 5 سنوات في حرارة السعودية.',
  'Clean throttle body & MAF sensor — Jeddah dust fouls them; restores idle & economy. (Known BM Mazda 3 MAF failure point.)': 'نظّف بوابة الخانق وحساس MAF — غبار جدة يلوّثهما؛ يعيد ثبات السرعة الاستاندر واقتصاد الوقود. (نقطة ضعف معروفة في حساس MAF لموديل BM من مازدا 3.)',
  'Iridium NGK ILKAR7L11 — every 120,000 km / 6 yr (Except-Europe schedule). Restores smooth idle & economy.': 'بواجي NGK إيريديوم ILKAR7L11 — كل 120,000 كم / 6 سنوات (جدول خارج أوروبا). يعيد ثبات السرعة الاستاندر واقتصاد الوقود.',
  'In-tank filter; replace on high mileage.': 'فلتر داخل الخزان؛ استبدله عند ارتفاع الممشى.',
  'Inspect for cracks/squeal; replace before it fails.': 'افحصه بحثاً عن تشققات/صرير؛ استبدله قبل أن يتعطل.',
  'Load-test yearly; Jeddah heat shortens battery life — plan to replace every 2–3 years.': 'اختبر الحمل سنوياً؛ حرارة جدة تقصّر عمر البطارية — خطّط لاستبدالها كل 2–3 سنوات.',
  'Inspect pads/discs & lubricate caliper slide pins — part of the 5-year Jeddah routine; prevents sticking calipers in the heat.': 'افحص الفحمات والأقراص وزيّت مسامير انزلاق الكاليبر — جزء من روتين جدة الخمسي؛ يمنع تعلّق الكاليبر في الحرارة.',
  'Check shocks, control arms, ball joints, sway-bar links, tie rods & coil springs — known BM Mazda 3 wear points on rough roads.': 'افحص المساعدات وأذرع التحكم ومفاصل الكرة وروابط عارضة التوازن وقضبان التوجيه والياي — نقاط تآكل معروفة في BM مازدا 3 على الطرق الوعرة.',

  // part-option notes — short descriptors
  'API SP / ILSAC GF-6A full synthetic — 4.2 L with filter, 4.0 L without': 'اصطناعي بالكامل API SP / ILSAC GF-6A — 4.2 لتر مع الفلتر، 4.0 لتر بدونه',
  'Widely stocked in KSA': 'متوفر بكثرة في السعودية',
  'Genuine, ships to KSA': 'أصلي، يُشحن إلى السعودية',
  'In stock · 4–5 days': 'متوفر · 4–5 أيام',
  'Activated carbon, odor control': 'كربون منشّط، يتحكم بالروائح',
  'Low dust, quiet': 'غبار أقل، هادئ',
  'Strong in heat': 'متين في الحرارة',
  'System holds ~6.6 L': 'سعة النظام ~6.6 لتر',
  'KSA-available compatible coolant (per 5-yr plan)': 'سائل تبريد متوافق ومتوفر في السعودية (حسب الخطة الخمسية)',
  'Compatible chemistry': 'تركيبة كيميائية متوافقة',
  '~3.5 L per drain, 7.8 L total': '~3.5 لتر لكل تصريف، 7.8 لتر إجمالاً',
  'OE supplier equivalent': 'مكافئ لمورّد الشركة المصنّعة (OE)',
  'Need ~1 L for a full flush': 'يلزم ~1 لتر للسحب الكامل',
  'Top up as needed': 'أضِف عند الحاجة',

  // part-option notes — symptom → action
  'Bouncy ride / clunks = replace in pairs': 'قيادة مرتدة / أصوات طرق = استبدل كزوج',
  'OEM-grade · in stock': 'بجودة الوكيل (OEM) · متوفر',
  'Budget · in stock': 'اقتصادي · متوفر',
  'Replace in pairs': 'استبدل كزوج',
  'Incl. ball joint & bushing': 'يشمل مفصل الكرة والبوش',
  'Complete arm · in stock': 'ذراع كامل · متوفر',
  'Ball joint only': 'مفصل الكرة فقط',
  'Creak/knock when turning = replace with struts': 'صرير/طرق عند اللف = استبدله مع المساعدات (Struts)',
  'Humming/whine from rear = replace': 'أزيز/صفير من الخلف = استبدل',
  'Rattle/clunk over bumps = worn links': 'طرقعة عند المطبات = روابط تالفة',
  'Misfire / rough idle / flashing CEL = replace': 'تفويت شرارة / سرعة استاندر غير منتظمة / وميض ضوء المحرك = استبدل',
  'In stock': 'متوفر',
  'Battery/charge warning light = check': 'ضوء تحذير البطارية/الشحن = افحص',
  'Slow / clicking crank = replace': 'بطء أو تكة عند إدارة المحرك = استبدل',
  'Vibration under braking / lip on edge = replace in pairs': 'اهتزاز عند الفرملة / حافة بارزة = استبدل كزوج',
  'Replace in pairs with pads': 'استبدل كزوج مع الفحمات',
  'Coolant leak / whine / overheating = replace': 'تسريب سائل تبريد / صفير / ارتفاع حرارة = استبدل',
  'OE supplier · in stock': 'مورّد الشركة المصنّعة (OE) · متوفر',
  'OE supplier': 'مورّد الشركة المصنّعة (OE)',
  'Overheating or slow warm-up = replace': 'ارتفاع حرارة أو بطء التسخين = استبدل',
  'CEL / rough idle / high fuel use = replace': 'ضوء المحرك / سرعة استاندر غير منتظمة / ارتفاع استهلاك الوقود = استبدل',
  'Clicking when turning = worn outer CV joint': 'تكة عند اللف = مفصل CV الخارجي تالف',
  'Full axle often cheaper than OEM joint': 'الفلنجة الكاملة غالباً أرخص من مفصل الوكيل الأصلي',
  'Common failure: hesitation / stalling / CEL — clean first, then replace': 'عطل شائع: تردد بالتسارع / توقف مفاجئ / ضوء المحرك — نظّفه أولاً ثم استبدله',
  'Known leak — Mazda extended the warranty on 2016–17. Weak A/C = check': 'تسريب معروف — مدّدت مازدا الضمان على موديلات 2016–17. ضعف التكييف = افحص',
  'Widely available': 'متوفر بكثرة',
  'Coil springs crack/break on Mazda 3 (esp. rear) — sag or clunk = replace in pairs': 'الياي يتشقق/ينكسر في مازدا 3 (خصوصاً الخلفي) — هبوط أو طرقعة = استبدل كزوج',
  'Humming/growling that rises with speed = replace': 'أزيز/هدير يزداد مع السرعة = استبدل',
  'Leak / overheating / coolant residue = replace': 'تسريب / ارتفاع حرارة / بقايا سائل تبريد = استبدل',
  'Vibration/clunk on start, idle or acceleration = worn mount': 'اهتزاز/طرقعة عند التشغيل أو السرعة الاستاندر أو التسارع = قاعدة محرك تالفة',
  'Sticking/leaking = pulling or uneven pad wear': 'تعلّق/تسريب = سحب للسيارة أو تآكل غير متساوٍ للفحمات',
  'Seals only — cheaper than full caliper': 'أويلات (سيلات) فقط — أرخص من كاليبر كامل',
  'No / weak / noisy airflow from vents = replace': 'انعدام / ضعف / ضوضاء الهواء من الفتحات = استبدل',
  'Cracked/fogged lens or dead unit': 'عدسة متشققة/ضبابية أو وحدة معطلة',
  'Weak/no cold air or noisy clutch = replace': 'ضعف أو انعدام التبريد أو ضوضاء الكلتش = استبدل',
  'Rear springs crack/sag on the BM Mazda 3 — replace in pairs': 'الياي الخلفي يتشقق/يهبط في BM مازدا 3 — استبدل كزوج',
  'Oil seep around the valve cover = replace': 'تسريب زيت حول غطاء الصمامات = استبدل',
  'Rough idle / oil consumption = replace': 'سرعة استاندر غير منتظمة / استهلاك زيت = استبدل',
  'No-start / stalling / CEL = replace': 'عدم التشغيل / توقف مفاجئ / ضوء المحرك = استبدل',
  'Rough running / CEL = replace': 'تشغيل غير منتظم / ضوء المحرك = استبدل',
  'After the catalytic converter — emissions CEL = replace': 'بعد المحول الحفّاز — ضوء المحرك بسبب الانبعاثات = استبدل',
  'Cranks-no-start / weak pressure = replace': 'المحرك يدور دون تشغيل / ضعف الضغط = استبدل',
  'Belt squeal/rattle = worn tensioner; replace with the belt': 'صرير/طرقعة السير = مشدّ تالف؛ استبدله مع السير',
  'Vibration/clunk on start & accel = worn mount. Verify no. by transmission/build.': 'اهتزاز/طرقعة عند التشغيل والتسارع = قاعدة تالفة. تحقق من الرقم حسب ناقل الحركة/تاريخ التصنيع.',
  'Clunk on gear engagement = worn mount. Verify no. by transmission/build.': 'طرقعة عند دخول الجير = قاعدة تالفة. تحقق من الرقم حسب ناقل الحركة/تاريخ التصنيع.',
  'Sinking pedal / internal leak = replace': 'دواسة تغوص / تسريب داخلي = استبدل',
  'Sticking/leaking = drag, pulling or uneven pad wear': 'تعلّق/تسريب = جر، سحب للسيارة أو تآكل غير متساوٍ للفحمات',
  'Cheaper than a full caliper': 'أرخص من كاليبر كامل',
  'Play/clunk in steering or uneven tire wear = replace': 'فراغ/طرقعة في التوجيه أو تآكل غير متساوٍ للإطارات = استبدل',
  'Consumable — dim/burnt-out beam. Halogen trims; verify your housing.': 'قطعة استهلاكية — إضاءة خافتة أو محروقة. للفئات الهالوجين؛ تحقق من نوع علبة المصباح لديك.',
  'Rattle on cold start / stretched chain at high km = replace kit': 'طرقعة عند التشغيل البارد / تمدد الجنزير عند ارتفاع الممشى = استبدل الطقم كاملاً',
  'Rubber hardens/cracks in Jeddah heat — verify exact numbers for 2.0 on PartSouq': 'المطاط يتصلب/يتشقق في حرارة جدة — تحقق من الأرقام الدقيقة لمحرك 2.0 على PartSouq',
  'Consumable — renew at every oil change to avoid seepage': 'قطعة استهلاكية — جدّدها مع كل تغيير زيت لتجنب التسريب',
  'Clunk/rattle over bumps = worn bushing; replace in pairs': 'طرقعة عند المطبات = بوش تالف؛ استبدل كزوج',
  'Fan works only on some speeds = failed resistor': 'المروحة تعمل على بعض السرعات فقط = مقاومة تالفة',
  'Consumable — replace burnt-out bulbs; halogen trims': 'قطعة استهلاكية — استبدل اللمبات المحروقة؛ للفئات الهالوجين',
  'EVAP CEL (P0441/P0455) or rough idle = replace': 'ضوء المحرك لنظام EVAP (P0441/P0455) أو سرعة استاندر غير منتظمة = استبدل',
  'CEL / reduced power / pinging = check': 'ضوء المحرك / انخفاض القوة / طرقعة المحرك (الفنجرة) = افحص',
  'Clicking on turns / torn CV boot = worn axle': 'تكة عند اللف / تمزق غطاء CV المطاطي = فلنجة تالفة',
  'ABS / traction / brake warning light on = replace': 'إضاءة ضوء ABS / التماسك / الفرامل = استبدل',
  'CEL / wrong temp reading / fan or fuel-trim issues = replace': 'ضوء المحرك / قراءة حرارة خاطئة / مشاكل المروحة أو ضبط الوقود = استبدل',
  'Vacuum leak / rough idle — renew when servicing the intake': 'تسريب هواء (فاكيوم) / سرعة استاندر غير منتظمة — جدّده عند صيانة مجمع السحب',

  // dashboard recommendation body text
  'In Jeddah\'s heat, shorten oil changes to ~7,500 km if you mostly do city driving. Fresh 5W-30 (API SP) keeps the SkyActiv engine clean.': 'في حرارة جدة، قلّل فترة تغيير الزيت إلى ~7,500 كم إذا كانت قيادتك غالباً داخل المدينة. الزيت الطازج 5W-30 (API SP) يحافظ على نظافة محرك SkyActiv.',
  'Keep tires at 36 PSI and check monthly (when cold). Correct pressure saves fuel and prevents blowouts on hot asphalt.': 'حافظ على ضغط الإطارات عند 36 رطل وافحصه شهرياً (والإطار بارد). الضغط الصحيح يوفر الوقود ويمنع الانفجار على الإسفلت الساخن.',
  'Heat-related wear shortens battery life in Jeddah — plan to replace it every 2–3 years, and load-test it yearly.': 'التآكل الناتج عن الحرارة يقصّر عمر البطارية في جدة — خطّط لاستبدالها كل 2–3 سنوات، واختبر حملها سنوياً.',
  'Wash the underbody occasionally to protect against corrosion from Jeddah\'s coastal salt air.': 'اغسل أسفل السيارة بين حين وآخر لحمايتها من الصدأ الناتج عن هواء جدة الساحلي المالح.',

  // store labels
  'Local parts market': 'سوق قطع الغيار المحلي',
  'Local battery shop': 'محل بطاريات محلي',
  'AC Delco / battery shop': 'AC Delco / محل بطاريات',
  'Mazda Dealer (Alireza)': 'وكيل مازدا (علي رضا)',

  // storage errors
  'Storage is full — your change was NOT saved. Remove some receipt photos.': 'مساحة التخزين ممتلئة — لم يتم حفظ التغيير. احذف بعض صور الإيصالات.',
  'Could not save your change.': 'تعذّر حفظ التغيير.',

  // odometer staleness
  'Mileage is {n} days old — due dates may be off': 'مضى {n} يوماً على تحديث العداد — قد تكون مواعيد الاستحقاق غير دقيقة',
  'Update ›': 'تحديث ›',

  // health breakdown
  'Health score': 'مؤشر الحالة',
  'what is affecting it': 'ما الذي يؤثر عليه',
  'Everything is on track.': 'كل شيء على المسار الصحيح.',

  // theme
  'Theme: follows device': 'المظهر: حسب الجهاز',
  'Theme: light': 'المظهر: فاتح',
  'Theme: dark': 'المظهر: داكن',

  // storage
  'Could not open your garage': 'تعذّر فتح المرآب',
  'Your data is safe. Please reload the page.': 'بياناتك آمنة. يرجى إعادة تحميل الصفحة.',

  // backup
  'Backup & restore': 'النسخ الاحتياطي والاستعادة',
  'A backup file holds every vehicle, service, receipt and photo.': 'ملف النسخة الاحتياطية يحتوي على كل مركبة وصيانة وإيصال وصورة.',
  'Export backup': 'تصدير نسخة احتياطية',
  'Import backup': 'استيراد نسخة احتياطية',
  'Backup downloaded': 'تم تنزيل النسخة الاحتياطية',
  'Garage restored': 'تمت استعادة المرآب',
  'Restored, but some data could not be saved': 'تمت الاستعادة، لكن تعذّر حفظ بعض البيانات',
  'Importing replaces everything currently in your garage. Continue?': 'الاستيراد سيستبدل كل ما في مرآبك حالياً. هل تريد المتابعة؟',
  'That file is not valid JSON.': 'هذا الملف ليس JSON صالحاً.',
  'That is not a Garage backup file.': 'هذا ليس ملف نسخة احتياطية للمرآب.',
  'That backup file is incomplete.': 'ملف النسخة الاحتياطية غير مكتمل.',
  'Could not read that file.': 'تعذّرت قراءة هذا الملف.',
};
function t(s) { return (lang === 'ar' && s != null && AR[s]) ? AR[s] : s; }
const monthsBetween = (a, b) => (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + (b.getDate() - a.getDate()) / 30;
const addMonths = (d, m) => { const x = new Date(d); x.setMonth(x.getMonth() + Math.round(m)); return x; };
const relDate = d => {
  const days = Math.round((d - today()) / 86400000);
  const ar = lang === 'ar';
  if (days === 0) return t('today');
  if (days < 0) return ar ? `قبل ${Math.abs(days)} يوم` : `${Math.abs(days)}d ago`;
  if (days < 45) return ar ? `خلال ${days} يوم` : `in ${days}d`;
  const mo = Math.round(days / 30);
  return ar ? `خلال ${mo} شهر` : `in ${mo} mo`;
};

/* ============================================================
   SEED DATA — Mazda 3 2.0 SkyActiv-G, Saudi (severe) intervals
   Odometer baseline ~155,000 km. All values editable in-app.
   ============================================================ */
/* ============================================================
   Mazda SkyActiv catalogue — a data-driven profile per model.
   The service schedule is shared (SkyActiv-G is near-identical across
   models); only oil capacity and part numbers vary. Adding a car builds
   a fresh profile from here — light, offline, and cloud-ready.
   ============================================================ */
const DEFAULT_COLOR = 'Meteor Gray Mica (Code 42A)';
// { id, model, generation, engines: [[code, oilLitresWithFilter], …] }
const CAR_MODELS = [
  { id: 'mazda2',   model: '2',     gen: 'DJ · 2015+',      engines: [['1.5L SkyActiv-G', 3.6]] },
  { id: 'mazda3bm', model: '3',     gen: 'BM/BN · 2014–18', engines: [['2.0L SkyActiv-G', 4.2], ['1.6L SkyActiv-G', 3.9]] },
  { id: 'mazda3bp', model: '3',     gen: 'BP · 2019+',      engines: [['2.0L SkyActiv-G', 4.2], ['1.5L SkyActiv-G', 3.6], ['2.5L SkyActiv-G', 4.5]] },
  { id: 'mazda6',   model: '6',     gen: 'GJ/GL · 2013+',   engines: [['2.5L SkyActiv-G', 4.5], ['2.0L SkyActiv-G', 4.3]] },
  { id: 'cx3',      model: 'CX-3',  gen: 'DK · 2015+',      engines: [['2.0L SkyActiv-G', 4.2]] },
  { id: 'cx30',     model: 'CX-30', gen: 'DM · 2019+',      engines: [['2.0L SkyActiv-G', 4.2], ['2.5L SkyActiv-G', 4.5]] },
  { id: 'cx5ke',    model: 'CX-5',  gen: 'KE · 2012–16',    engines: [['2.0L SkyActiv-G', 4.2], ['2.5L SkyActiv-G', 4.8]] },
  { id: 'cx5kf',    model: 'CX-5',  gen: 'KF · 2017+',      engines: [['2.5L SkyActiv-G', 4.8], ['2.0L SkyActiv-G', 4.2]] },
  { id: 'cx9',      model: 'CX-9',  gen: 'TC · 2016+',      engines: [['2.5L Turbo SkyActiv-G', 5.4]] }
];

/* Shared SkyActiv-G schedule (Jeddah "severe" base intervals; dealer "normal"
   values are layered on in normalizeData). Oil quantity varies per engine. */
function skyactivServices(oilL) {
  return [
      { id: uid(), name: 'Engine Oil & Filter', icon: '🛢️', cat: 'Engine',
        intervalKm: 7500, intervalMonths: 6, lastKm: 0, lastDate: '', cost: 305,
        note: `5W-30 (API SP / ILSAC GF-6A) full synthetic — ~${oilL} L with filter. Every 7,500 km / 6 mo (severe) for Jeddah heat, dust & city driving. Add a fuel-system cleaner each oil change — mandatory for the direct-injection SkyActiv-G to keep injectors & intake valves clean.` },
      { id: uid(), name: 'Tire Rotation & Balance', icon: '🔄', cat: 'Tires',
        intervalKm: 10000, intervalMonths: 12, lastKm: 309000, lastDate: '2026-03-01', cost: 80,
        note: 'Rotate front/rear and rebalance to even out wear.' },
      { id: uid(), name: 'Cabin (A/C) Filter', icon: '❄️', cat: 'Interior',
        intervalKm: 15000, intervalMonths: 12, lastKm: 306000, lastDate: '2026-01-20', cost: 70,
        note: 'Jeddah dust clogs it fast — replace ~yearly / 15,000 km; check before summer A/C season.' },
      { id: uid(), name: 'Engine Air Filter', icon: '🌬️', cat: 'Engine',
        intervalKm: 20000, intervalMonths: 24, lastKm: 301000, lastDate: '2025-08-10', cost: 90,
        note: 'Inspect earlier in sandy conditions.' },
      { id: uid(), name: 'Wheel Alignment', icon: '🎯', cat: 'Tires',
        intervalKm: 20000, intervalMonths: 24, lastKm: 301000, lastDate: '2025-08-10', cost: 120,
        note: 'Also after any pothole hit or new tires.' },
      { id: uid(), name: 'Brake Fluid', icon: '🩸', cat: 'Brakes',
        intervalKm: 40000, intervalMonths: 24, lastKm: 289000, lastDate: '2024-09-01', cost: 150,
        note: 'DOT 3/4 (~1 L). Absorbs moisture over time — flush every 2 years.' },
      { id: uid(), name: 'Automatic Transmission Fluid', icon: '⚙️', cat: 'Drivetrain',
        intervalKm: 60000, intervalMonths: 48, lastKm: 261000, lastDate: '2023-05-01', cost: 480,
        note: 'Mazda Genuine ATF-FZ only — ~3.5 L per drain (7.8 L total). Every 60–80k km; dealer or specialist.' },
      { id: uid(), name: 'Engine Coolant (FL22)', icon: '🌡️', cat: 'Engine',
        intervalKm: 120000, intervalMonths: 60, lastKm: 291000, lastDate: '2023-08-01', cost: 220,
        note: 'Mazda FL22 long-life (HOAT), ~6.6 L. Replace every 5 years in KSA heat.' },
      { id: uid(), name: 'Throttle Body & MAF Cleaning', icon: '🧴', cat: 'Engine',
        intervalKm: 15000, intervalMonths: 12, lastKm: 309000, lastDate: '2025-10-01', cost: 60,
        note: 'Clean throttle body & MAF sensor — Jeddah dust fouls them; restores idle & economy. (A known SkyActiv-G MAF weak point.)' },
      { id: uid(), name: 'Spark Plugs (x4)', icon: '⚡', cat: 'Engine',
        intervalKm: 120000, intervalMonths: 72, lastKm: 257000, lastDate: '2022-06-01', cost: 340,
        note: 'Iridium NGK ILKAR7L11 — every 120,000 km / 6 yr (Except-Europe schedule). Restores smooth idle & economy.' },
      { id: uid(), name: 'Fuel Filter', icon: '⛽', cat: 'Engine',
        intervalKm: 80000, intervalMonths: 72, lastKm: 241000, lastDate: '2021-05-01', cost: 180,
        note: 'In-tank filter; replace on high mileage.' },
      { id: uid(), name: 'Drive (Serpentine) Belt', icon: '🔗', cat: 'Engine',
        intervalKm: 90000, intervalMonths: 72, lastKm: 251000, lastDate: '2021-11-01', cost: 200,
        note: 'Inspect for cracks/squeal; replace before it fails.' },
      { id: uid(), name: 'Battery Check', icon: '🔋', cat: 'Electrical',
        intervalKm: 30000, intervalMonths: 12, lastKm: 311000, lastDate: '2025-10-01', cost: 0,
        note: 'Load-test yearly; Jeddah heat shortens battery life — plan to replace every 2–3 years.' },
      { id: uid(), name: 'Brake Inspection & Caliper Lube', icon: '🛑', cat: 'Brakes',
        intervalKm: 10000, intervalMonths: 12, lastKm: 309000, lastDate: '2025-10-01', cost: 50,
        note: 'Inspect pads/discs & lubricate caliper slide pins — part of the 5-year Jeddah routine; prevents sticking calipers in the heat.' },
      { id: uid(), name: 'Suspension & Steering Inspection', icon: '🔧', cat: 'Suspension',
        intervalKm: 20000, intervalMonths: 24, lastKm: 301000, lastDate: '2025-08-10', cost: 0,
        note: 'Check shocks, control arms, ball joints, sway-bar links, tie rods & coil springs — common SkyActiv wear points on rough roads.' }
  ];
}

/* Full parts catalogue for the Mazda 3 (BM · 2.0). Other models start from the
   shared consumables and gain their own OEM numbers over time. */
function mazda3Parts() {
  return [
      { id: uid(), name: 'Engine Oil 5W-30 (4L)', icon: '🛢️', cat: 'Engine',
        options: [
          { tag: 'OEM', brand: 'Shell Helix Ultra SP 5W-30 (dexos1 Gen3)', partNo: '', price: 160, store: 'Amazon.sa', note: 'API SP / ILSAC GF-6A full synthetic — 4.2 L with filter, 4.0 L without' },
          { tag: 'ALT', brand: 'TotalEnergies Quartz 9000 Future FGC 5W-30', partNo: '', price: 150, store: 'noon', note: 'Widely stocked in KSA' },
          { tag: 'ALT', brand: 'Fuchs Titan Supersyn D1 SAE 5W-30', partNo: '', price: 145, store: 'Local parts market' }
        ] },
      { id: uid(), name: 'Oil Filter', icon: '🧽', cat: 'Engine', partsouq: 'PE0114302A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'PE01-14-302A', price: 45, store: 'Mazda Dealer (Alireza)' },
          { tag: 'ALT', brand: 'Mazda Genuine PE01-14-302A', partNo: 'PE0114302A', price: 22, store: 'PartSouq ↗', note: 'Genuine, ships to KSA' },
          { tag: 'ALT', brand: 'Denso 150-2010', partNo: '150-2010', price: 28, store: 'Amazon.sa' },
          { tag: 'ALT', brand: 'Bosch 3330', partNo: '3330', price: 25, store: 'Local parts market' }
        ] },
      { id: uid(), name: 'Engine Air Filter', icon: '🌬️', cat: 'Engine', partsouq: 'PE07133A0A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'PE07-13-3A0A', price: 95, store: 'Mazda Dealer (Alireza)' },
          { tag: 'ALT', brand: 'Blue Print ADM52264', partNo: 'ADM52264', price: 25, store: 'PartSouq ↗', note: 'In stock · 4–5 days' },
          { tag: 'ALT', brand: 'WIX WA9774', partNo: 'WA9774', price: 25, store: 'PartSouq ↗' },
          { tag: 'ALT', brand: 'Denso Air Filter', partNo: '', price: 55, store: 'Amazon.sa' }
        ] },
      { id: uid(), name: 'Cabin A/C Filter', icon: '❄️', cat: 'Interior', partsouq: 'KD4561J6X',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'KD45-61-J6X', price: 80, store: 'Mazda Dealer (Alireza)' },
          { tag: 'ALT', brand: 'Filtron K1316', partNo: 'K1316', price: 29, store: 'PartSouq ↗' },
          { tag: 'ALT', brand: 'Denso Carbon Cabin', partNo: '', price: 45, store: 'Amazon.sa', note: 'Activated carbon, odor control' }
        ] },
      { id: uid(), name: 'Spark Plugs (each)', icon: '⚡', cat: 'Engine', partsouq: 'PE5R18110',
        options: [
          { tag: 'OEM', brand: 'Mazda / NGK ILKAR7L11 (verified for your VIN)', partNo: 'PE5R-18-110', price: 70, store: 'Mazda Dealer (Alireza)' },
          { tag: 'ALT', brand: 'Mazda Genuine PE5R-18-110', partNo: 'PE5R18110', price: 84, store: 'PartSouq ↗', note: 'Genuine, ships to KSA' },
          { tag: 'ALT', brand: 'NGK Iridium ILKAR7L11', partNo: '94124', price: 55, store: 'Amazon.sa' },
          { tag: 'ALT', brand: 'Denso Iridium TT', partNo: '', price: 48, store: 'noon' }
        ] },
      { id: uid(), name: 'Front Brake Pads', icon: '🛑', cat: 'Brakes', partsouq: 'B4Y03328ZB',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'B4Y0-33-28ZB', price: 320, store: 'Mazda Dealer (Alireza)' },
          { tag: 'ALT', brand: 'Asimco KD3043', partNo: 'KD3043', price: 57, store: 'PartSouq ↗', note: 'In stock · 4–5 days' },
          { tag: 'ALT', brand: 'Akebono Ceramic', partNo: '', price: 210, store: 'Amazon.sa', note: 'Low dust, quiet' },
          { tag: 'ALT', brand: 'Bosch QuietCast', partNo: '', price: 180, store: 'Local parts market' }
        ] },
      { id: uid(), name: 'Rear Brake Pads', icon: '🛑', cat: 'Brakes', partsouq: 'B4Y02648ZB',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'B4Y0-26-48ZB', price: 260, store: 'Mazda Dealer (Alireza)' },
          { tag: 'ALT', brand: 'Akebono Ceramic', partNo: '', price: 170, store: 'Amazon.sa' }
        ] },
      { id: uid(), name: 'Wiper Blades (pair)', icon: '🌧️', cat: 'Exterior',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: '', price: 150, store: 'Mazda Dealer (Alireza)' },
          { tag: 'ALT', brand: 'Bosch Aerotwin', partNo: '', price: 95, store: 'Amazon.sa' },
          { tag: 'ALT', brand: 'Valeo First', partNo: '', price: 70, store: 'noon' }
        ] },
      { id: uid(), name: '12V Battery', icon: '🔋', cat: 'Electrical',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine 55Ah', partNo: '', price: 480, store: 'Mazda Dealer (Alireza)' },
          { tag: 'ALT', brand: 'Varta Blue Dynamic', partNo: '', price: 360, store: 'AC Delco / battery shop', note: 'Strong in heat' },
          { tag: 'ALT', brand: 'AC Delco', partNo: '', price: 320, store: 'Local battery shop' }
        ] },
      { id: uid(), name: 'Serpentine Belt', icon: '🔗', cat: 'Engine', partsouq: 'PE0815909B',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'PE08-15-909B', price: 150, store: 'Mazda Dealer (Alireza)' },
          { tag: 'ALT', brand: 'Gates Micro-V', partNo: '', price: 90, store: 'Amazon.sa' },
          { tag: 'ALT', brand: 'Dayco', partNo: '', price: 80, store: 'Local parts market' }
        ] },
      { id: uid(), name: 'Coolant FL22 (long-life)', icon: '🌡️', cat: 'Engine',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine FL22 Long Life', partNo: '0000-77-508E-20', price: 130, store: 'Mazda Dealer (Alireza)', note: 'System holds ~6.6 L' },
          { tag: 'ALT', brand: 'Total Glacelf Auto Supra', partNo: '', price: 85, store: 'Local parts market', note: 'KSA-available compatible coolant (per 5-yr plan)' },
          { tag: 'ALT', brand: 'Zerex Asian Blue (P-HOAT)', partNo: '', price: 85, store: 'Amazon.sa', note: 'Compatible chemistry' }
        ] },
      { id: uid(), name: 'ATF FZ (per liter)', icon: '⚙️', cat: 'Drivetrain',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine ATF-FZ (only)', partNo: '0000-77-112E-01', price: 60, store: 'Mazda Dealer (Alireza)', note: '~3.5 L per drain, 7.8 L total' },
          { tag: 'ALT', brand: 'Idemitsu Type FZ', partNo: '', price: 42, store: 'Amazon.sa', note: 'OE supplier equivalent' }
        ] },
      { id: uid(), name: 'Brake Fluid (DOT 4)', icon: '🩸', cat: 'Brakes',
        options: [
          { tag: 'OEM', brand: 'Motul DOT 3 & 4', partNo: '', price: 35, store: 'Amazon.sa', note: 'Need ~1 L for a full flush' },
          { tag: 'ALT', brand: 'ACDelco DOT 4', partNo: '', price: 28, store: 'Local parts market' }
        ] },
      { id: uid(), name: 'Windshield Washer Fluid (~2L)', icon: '💦', cat: 'Exterior',
        options: [
          { tag: 'ALT', brand: 'Ready-mix washer fluid (anti-streak)', partNo: '', price: 15, store: 'noon', note: 'Top up as needed' }
        ] },
      /* ---- Suspension wear parts (verified for your VIN) ---- */
      { id: uid(), name: 'Front Shock Absorber (each)', icon: '🌀', cat: 'Suspension', partsouq: 'BHS234700A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine — R: BHS2-34-700A · L: BHS2-34-900A', partNo: 'BHS2-34-700A', price: 286, store: 'Mazda Dealer (Alireza)', note: 'Bouncy ride / clunks = replace in pairs' },
          { tag: 'ALT', brand: 'KYB 3340035', partNo: '3340035', price: 323, store: 'PartSouq ↗', note: 'OEM-grade · in stock' },
          { tag: 'ALT', brand: 'Orient ORMZ3340035', partNo: 'ORMZ3340035', price: 103, store: 'PartSouq ↗', note: 'Budget · in stock' }
        ] },
      { id: uid(), name: 'Rear Shock Absorber (each)', icon: '🌀', cat: 'Suspension', partsouq: 'B45A28910B',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'B45A-28-910B', price: 313, store: 'Mazda Dealer (Alireza)', note: 'Replace in pairs' },
          { tag: 'ALT', brand: 'Aftermarket (Orient) ORMZ3430041', partNo: 'ORMZ3430041', price: 46, store: 'PartSouq ↗', note: 'Budget · in stock' }
        ] },
      { id: uid(), name: 'Front Lower Control Arm (each)', icon: '🦴', cat: 'Suspension', partsouq: 'B60S34300',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine — R: B60S-34-300 · L: B60S-34-350', partNo: 'B60S-34-300', price: 417, store: 'Mazda Dealer (Alireza)', note: 'Incl. ball joint & bushing' },
          { tag: 'ALT', brand: 'Schnieder MZS2201914', partNo: 'MZS2201914', price: 173, store: 'PartSouq ↗', note: 'Complete arm · in stock' },
          { tag: 'ALT', brand: 'Febest Ball Joint 0520KE', partNo: '0520KE', price: 41, store: 'PartSouq ↗', note: 'Ball joint only' }
        ] },
      { id: uid(), name: 'Front Strut Mount Bearing (each)', icon: '⭕', cat: 'Suspension', partsouq: 'KR273438X',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'KR27-34-38X', price: 60, store: 'Mazda Dealer (Alireza)', note: 'Creak/knock when turning = replace with struts' }
        ] },
      { id: uid(), name: 'Rear Wheel Hub Bearing (each)', icon: '⭕', cat: 'Suspension', partsouq: 'B45A2615X',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine — hub + bearing', partNo: 'B45A-26-15X', price: 340, store: 'Mazda Dealer (Alireza)', note: 'Humming/whine from rear = replace' }
        ] },
      { id: uid(), name: 'Stabilizer (Sway Bar) Link', icon: '🔗', cat: 'Suspension', partsouq: 'KD3128170',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine — R: KD31-28-170 · L: KD31-28-190', partNo: 'KD31-28-170', price: 90, store: 'Mazda Dealer (Alireza)', note: 'Rattle/clunk over bumps = worn links' }
        ] },
      /* ---- Electrical wear parts (verified for your VIN) ---- */
      { id: uid(), name: 'Ignition Coil (each)', icon: '⚡', cat: 'Electrical', partsouq: 'PE2018100A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'PE20-18-100A', price: 545, store: 'Mazda Dealer (Alireza)', note: 'Misfire / rough idle / flashing CEL = replace' },
          { tag: 'ALT', brand: 'Febest 05640002', partNo: '05640002', price: 158, store: 'PartSouq ↗', note: 'In stock' }
        ] },
      { id: uid(), name: 'Alternator', icon: '🔌', cat: 'Electrical', partsouq: 'PE0118300',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'PE01-18-300', price: 1026, store: 'Mazda Dealer (Alireza)', note: 'Battery/charge warning light = check' },
          { tag: 'ALT', brand: 'Schnieder MZS1100125', partNo: 'MZS1100125', price: 362, store: 'PartSouq ↗' }
        ] },
      { id: uid(), name: 'Starter Motor', icon: '🔌', cat: 'Electrical', partsouq: 'PE0718400',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'PE07-18-400', price: 527, store: 'Mazda Dealer (Alireza)', note: 'Slow / clicking crank = replace' }
        ] },
      /* ---- Brakes: discs / rotors (verified for your VIN) ---- */
      { id: uid(), name: 'Front Brake Disc (each)', icon: '💿', cat: 'Brakes', partsouq: 'B45G33251A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'B45G-33-251A', price: 271, store: 'Mazda Dealer (Alireza)', note: 'Vibration under braking / lip on edge = replace in pairs' },
          { tag: 'ALT', brand: 'Hi-Q SD4440', partNo: 'SD4440', price: 133, store: 'PartSouq ↗', note: 'In stock' }
        ] },
      { id: uid(), name: 'Rear Brake Disc (each)', icon: '💿', cat: 'Brakes', partsouq: 'B45G26251A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'B45G-26-251A', price: 163, store: 'Mazda Dealer (Alireza)', note: 'Replace in pairs with pads' }
        ] },
      /* ---- Cooling / engine wear (verified for your VIN) ---- */
      { id: uid(), name: 'Water Pump', icon: '💧', cat: 'Engine', partsouq: 'PE0115010B',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'PE01-15-010B', price: 257, store: 'Mazda Dealer (Alireza)', note: 'Coolant leak / whine / overheating = replace' },
          { tag: 'ALT', brand: 'GMB GWMZ79AH', partNo: 'GWMZ79AH', price: 198, store: 'PartSouq ↗', note: 'OE supplier · in stock' },
          { tag: 'ALT', brand: 'GMB (OE) PE01-15-010B', partNo: 'PE0115010B', price: 128, store: 'PartSouq ↗', note: 'OE supplier' }
        ] },
      { id: uid(), name: 'Thermostat', icon: '🌡️', cat: 'Engine', partsouq: 'PE0115171',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (2.0 SkyActiv-G)', partNo: 'PE01-15-171', price: 55, store: 'Mazda Dealer (Alireza)', note: 'Overheating or slow warm-up = replace' }
        ] },
      { id: uid(), name: 'A/F (Oxygen) Sensor — upstream', icon: '📡', cat: 'Engine', partsouq: 'PE01188G1A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'PE01-18-8G1A', price: 529, store: 'Mazda Dealer (Alireza)', note: 'CEL / rough idle / high fuel use = replace' }
        ] },
      /* ---- Drivetrain: CV axle joint (verified for your VIN) ---- */
      { id: uid(), name: 'Front CV Axle Joint (outer)', icon: '🦴', cat: 'Drivetrain', partsouq: 'FTC322510',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine — R outer FTC3-22-510', partNo: 'FTC3-22-510', price: 1001, store: 'Mazda Dealer (Alireza)', note: 'Clicking when turning = worn outer CV joint' },
          { tag: 'ALT', brand: 'Aftermarket complete axle', partNo: '', price: 260, store: 'Local parts market', note: 'Full axle often cheaper than OEM joint' }
        ] },
      /* ---- Known failure-prone parts on the BM Mazda 3 (researched) ---- */
      { id: uid(), name: 'MAF (Mass Air Flow) Sensor', icon: '📡', cat: 'Engine', partsouq: 'PE0113215',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'PE01-13-215', price: 534, store: 'Mazda Dealer (Alireza)', note: 'Common failure: hesitation / stalling / CEL — clean first, then replace' }
        ] },
      { id: uid(), name: 'A/C Condenser', icon: '❄️', cat: 'A/C', partsouq: 'GHR161480B',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'GHR1-61-480B', price: 794, store: 'Mazda Dealer (Alireza)', note: 'Known leak — Mazda extended the warranty on 2016–17. Weak A/C = check' },
          { tag: 'ALT', brand: 'Aftermarket condenser', partNo: '', price: 300, store: 'Local parts market', note: 'Widely available' }
        ] },
      { id: uid(), name: 'Front Coil Spring (each)', icon: '🌀', cat: 'Suspension', partsouq: 'B45M34011A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine — front B45M-34-011A', partNo: 'B45M-34-011A', price: 192, store: 'Mazda Dealer (Alireza)', note: 'Coil springs crack/break on Mazda 3 (esp. rear) — sag or clunk = replace in pairs' }
        ] },
      { id: uid(), name: 'Front Wheel Hub Bearing (each)', icon: '⭕', cat: 'Suspension', partsouq: 'B45A3304X',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'B45A-33-04X', price: 583, store: 'Mazda Dealer (Alireza)', note: 'Humming/growling that rises with speed = replace' }
        ] },
      /* ---- More common replaceables (verified for your VIN) ---- */
      { id: uid(), name: 'Radiator', icon: '🧊', cat: 'Engine', partsouq: 'PE2015200',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'PE20-15-200', price: 989, store: 'Mazda Dealer (Alireza)', note: 'Leak / overheating / coolant residue = replace' },
          { tag: 'ALT', brand: 'Aftermarket radiator', partNo: '', price: 280, store: 'Local parts market', note: 'Widely available' }
        ] },
      { id: uid(), name: 'Engine Mount (No.4, right)', icon: '🧱', cat: 'Engine', partsouq: 'GHR939070B',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'GHR9-39-070B', price: 217, store: 'Mazda Dealer (Alireza)', note: 'Vibration/clunk on start, idle or acceleration = worn mount' },
          { tag: 'ALT', brand: 'Febest MZMGJLH', partNo: 'MZMGJLH', price: 230, store: 'PartSouq ↗' }
        ] },
      { id: uid(), name: 'Front Brake Caliper (each)', icon: '🗜️', cat: 'Brakes', partsouq: 'B4Y73398ZB',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine — R: B4Y7-33-98ZB · L: B4Y7-33-99ZB', partNo: 'B4Y7-33-98ZB', price: 491, store: 'Mazda Dealer (Alireza)', note: 'Sticking/leaking = pulling or uneven pad wear' },
          { tag: 'ALT', brand: 'Febest rebuild kit 0575BMF', partNo: '0575BMF', price: 30, store: 'PartSouq ↗', note: 'Seals only — cheaper than full caliper' }
        ] },
      { id: uid(), name: 'Blower Motor (A/C fan)', icon: '💨', cat: 'A/C', partsouq: 'KD4561B10',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (verified for your VIN)', partNo: 'KD45-61-B10', price: 700, store: 'Mazda Dealer (Alireza)', note: 'No / weak / noisy airflow from vents = replace' }
        ] },
      { id: uid(), name: 'Headlight Unit (each)', icon: '💡', cat: 'Exterior', partsouq: 'BHW3510K0A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine — R: BHW3-51-0K0A · L: BHW3-51-0L0A', partNo: 'BHW3-51-0K0A', price: 902, store: 'Mazda Dealer (Alireza)', note: 'Cracked/fogged lens or dead unit' },
          { tag: 'ALT', brand: 'Aftermarket headlight unit', partNo: '', price: 450, store: 'Local parts market' }
        ] },
      /* ---- Added parts (2016 BM · 2.0 SkyActiv-G — OEM numbers via genuine catalogs; verify on PartSouq) ---- */
      { id: uid(), name: 'A/C Compressor', icon: '❄️', cat: 'A/C', partsouq: 'BHS261450',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: 'BHS2-61-450', price: 1450, store: 'Mazda Dealer (Alireza)', note: 'Weak/no cold air or noisy clutch = replace' },
          { tag: 'ALT', brand: 'Aftermarket / reman compressor', partNo: '', price: 620, store: 'Local parts market' }
        ] },
      { id: uid(), name: 'Rear Coil Spring (each)', icon: '🌀', cat: 'Suspension', partsouq: 'BHN528011A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: 'BHN5-28-011A', price: 185, store: 'Mazda Dealer (Alireza)', note: 'Rear springs crack/sag on the BM Mazda 3 — replace in pairs' }
        ] },
      { id: uid(), name: 'Valve Cover Gasket', icon: '🛢️', cat: 'Engine', partsouq: 'PE0110235',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (2.0 SkyActiv-G)', partNo: 'PE01-10-235', price: 90, store: 'Mazda Dealer (Alireza)', note: 'Oil seep around the valve cover = replace' },
          { tag: 'ALT', brand: 'Aftermarket gasket', partNo: '', price: 45, store: 'Amazon.sa' }
        ] },
      /* ---- Wear & failure-prone + consumables (2016 BM · 2.0 SkyActiv-G — verify numbers on PartSouq) ---- */
      { id: uid(), name: 'PCV Valve', icon: '🫧', cat: 'Engine', partsouq: 'PE0113890',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (SkyActiv-G)', partNo: 'PE01-13-890', price: 70, store: 'Mazda Dealer (Alireza)', note: 'Rough idle / oil consumption = replace' },
          { tag: 'ALT', brand: 'Aftermarket PCV valve', partNo: '', price: 35, store: 'Amazon.sa' }
        ] },
      { id: uid(), name: 'Crankshaft Position Sensor', icon: '📡', cat: 'Electrical', partsouq: 'PE0118221',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: 'PE01-18-221', price: 150, store: 'Mazda Dealer (Alireza)', note: 'No-start / stalling / CEL = replace' },
          { tag: 'ALT', brand: 'Denso / aftermarket', partNo: '', price: 80, store: 'Amazon.sa' }
        ] },
      { id: uid(), name: 'Camshaft Position Sensor', icon: '📡', cat: 'Electrical', partsouq: 'PE0118230',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: 'PE01-18-230', price: 150, store: 'Mazda Dealer (Alireza)', note: 'Rough running / CEL = replace' },
          { tag: 'ALT', brand: 'Denso / aftermarket', partNo: '', price: 80, store: 'Amazon.sa' }
        ] },
      { id: uid(), name: 'Oxygen Sensor — downstream (rear)', icon: '📡', cat: 'Engine', partsouq: 'PEDE1886Z',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: 'PEDE-18-86Z', price: 360, store: 'Mazda Dealer (Alireza)', note: 'After the catalytic converter — emissions CEL = replace' },
          { tag: 'ALT', brand: 'Denso / NTK O2 sensor', partNo: '', price: 170, store: 'Amazon.sa' }
        ] },
      { id: uid(), name: 'Fuel Pump Assembly (in-tank)', icon: '⛽', cat: 'Engine', partsouq: 'PE181335X',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (incl. sender)', partNo: 'PE18-13-35X', price: 620, store: 'Mazda Dealer (Alireza)', note: 'Cranks-no-start / weak pressure = replace' },
          { tag: 'ALT', brand: 'Aftermarket pump module', partNo: '', price: 280, store: 'Local parts market' }
        ] },
      { id: uid(), name: 'Drive Belt Tensioner', icon: '🔗', cat: 'Engine', partsouq: 'PE0315980A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: 'PE03-15-980A', price: 180, store: 'Mazda Dealer (Alireza)', note: 'Belt squeal/rattle = worn tensioner; replace with the belt' },
          { tag: 'ALT', brand: 'Gates / Dayco tensioner', partNo: '', price: 110, store: 'Amazon.sa' }
        ] },
      { id: uid(), name: 'Front Engine Mount', icon: '🧱', cat: 'Engine', partsouq: 'BCKA39060A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: 'BCKA-39-060A', price: 240, store: 'Mazda Dealer (Alireza)', note: 'Vibration/clunk on start & accel = worn mount. Verify no. by transmission/build.' },
          { tag: 'ALT', brand: 'Aftermarket mount', partNo: '', price: 120, store: 'Local parts market' }
        ] },
      { id: uid(), name: 'Transmission Mount', icon: '🧱', cat: 'Drivetrain', partsouq: 'BBR339070A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: 'BBR3-39-070A', price: 300, store: 'Mazda Dealer (Alireza)', note: 'Clunk on gear engagement = worn mount. Verify no. by transmission/build.' },
          { tag: 'ALT', brand: 'Aftermarket mount', partNo: '', price: 150, store: 'Local parts market' }
        ] },
      { id: uid(), name: 'Brake Master Cylinder', icon: '🛑', cat: 'Brakes', partsouq: 'BHY24340Z',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: 'BHY2-43-40Z', price: 520, store: 'Mazda Dealer (Alireza)', note: 'Sinking pedal / internal leak = replace' },
          { tag: 'ALT', brand: 'Centric / aftermarket', partNo: '', price: 260, store: 'Amazon.sa' }
        ] },
      { id: uid(), name: 'Rear Brake Caliper (each)', icon: '🗜️', cat: 'Brakes', partsouq: 'B4Y72698ZC',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine — R: B4Y7-26-98ZC · L: BJY7-26-99Z', partNo: 'B4Y7-26-98ZC', price: 430, store: 'Mazda Dealer (Alireza)', note: 'Sticking/leaking = drag, pulling or uneven pad wear' },
          { tag: 'ALT', brand: 'Caliper rebuild kit (seals)', partNo: '', price: 35, store: 'PartSouq ↗', note: 'Cheaper than a full caliper' }
        ] },
      { id: uid(), name: 'Outer Tie Rod End (each)', icon: '🔩', cat: 'Suspension', partsouq: 'GHT232290A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: 'GHT2-32-290A', price: 120, store: 'Mazda Dealer (Alireza)', note: 'Play/clunk in steering or uneven tire wear = replace' },
          { tag: 'ALT', brand: '555 / CTR tie rod end', partNo: '', price: 45, store: 'Local parts market' }
        ] },
      { id: uid(), name: 'Headlight Bulbs (H11 low · 9005 high)', icon: '💡', cat: 'Exterior',
        options: [
          { tag: 'OEM', brand: 'Philips / Osram halogen (H11 + 9005/HB3)', partNo: 'H11 · 9005', price: 60, store: 'Amazon.sa', note: 'Consumable — dim/burnt-out beam. Halogen trims; verify your housing.' },
          { tag: 'ALT', brand: 'LED conversion kit (H11 + 9005)', partNo: '', price: 120, store: 'noon' }
        ] },
      /* ---- High-mileage wear & service consumables (2016 BM · verify numbers on PartSouq) ---- */
      { id: uid(), name: 'Timing Chain Kit', icon: '⛓️', cat: 'Engine', partsouq: 'PE0112500A',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine — chain PE01-12-201 · tensioner PE01-12-500A', partNo: 'PE01-12-500A', price: 850, store: 'Mazda Dealer (Alireza)', note: 'Rattle on cold start / stretched chain at high km = replace kit' },
          { tag: 'ALT', brand: 'Aftermarket chain kit (chain, tensioner, guides)', partNo: '', price: 350, store: 'Local parts market' }
        ] },
      { id: uid(), name: 'Radiator Hoses (upper & lower)', icon: '💧', cat: 'Engine',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine upper + lower hose', partNo: '', price: 200, store: 'Mazda Dealer (Alireza)', note: 'Rubber hardens/cracks in Jeddah heat — verify exact numbers for 2.0 on PartSouq' },
          { tag: 'ALT', brand: 'Gates / aftermarket hose', partNo: '', price: 90, store: 'Local parts market' }
        ] },
      { id: uid(), name: 'Oil Drain Plug Gasket (14mm crush washer)', icon: '⭕', cat: 'Engine', partsouq: '995641400',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine crush washer', partNo: '9956-41-400', price: 5, store: 'Mazda Dealer (Alireza)', note: 'Consumable — renew at every oil change to avoid seepage' }
        ] },
      { id: uid(), name: 'Front Sway Bar Bushing', icon: '🔘', cat: 'Suspension', partsouq: 'B60P34156',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: 'B60P-34-156', price: 30, store: 'Mazda Dealer (Alireza)', note: 'Clunk/rattle over bumps = worn bushing; replace in pairs' },
          { tag: 'ALT', brand: 'Moog / polyurethane bushing', partNo: '', price: 20, store: 'Amazon.sa' }
        ] },
      { id: uid(), name: 'Blower Motor Resistor', icon: '🎛️', cat: 'A/C', partsouq: 'KD4561B15',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: 'KD45-61-B15', price: 180, store: 'Mazda Dealer (Alireza)', note: 'Fan works only on some speeds = failed resistor' },
          { tag: 'ALT', brand: 'Aftermarket resistor', partNo: '', price: 70, store: 'Amazon.sa' }
        ] },
      { id: uid(), name: 'Tail / Brake Light Bulbs', icon: '💡', cat: 'Exterior',
        options: [
          { tag: 'OEM', brand: 'Philips / Osram (brake, tail, reverse, signal)', partNo: '', price: 25, store: 'Amazon.sa', note: 'Consumable — replace burnt-out bulbs; halogen trims' }
        ] },
      /* ---- More common-failure parts (2016 BM · verify numbers on PartSouq) ---- */
      { id: uid(), name: 'EVAP Purge Valve (canister solenoid)', icon: '🫧', cat: 'Engine', partsouq: 'PE0118751',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: 'PE01-18-751', price: 130, store: 'Mazda Dealer (Alireza)', note: 'EVAP CEL (P0441/P0455) or rough idle = replace' },
          { tag: 'ALT', brand: 'Aftermarket purge solenoid', partNo: '', price: 60, store: 'Amazon.sa' }
        ] },
      { id: uid(), name: 'Knock Sensor', icon: '📡', cat: 'Engine', partsouq: 'PE0118921',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: 'PE01-18-921', price: 160, store: 'Mazda Dealer (Alireza)', note: 'CEL / reduced power / pinging = check' }
        ] },
      { id: uid(), name: 'Front CV Axle (complete, each)', icon: '🦴', cat: 'Drivetrain', partsouq: 'FT0C2550X',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine — R: FT0C-25-50X', partNo: 'FT0C-25-50X', price: 780, store: 'Mazda Dealer (Alireza)', note: 'Clicking on turns / torn CV boot = worn axle' },
          { tag: 'ALT', brand: 'Aftermarket complete axle', partNo: '', price: 260, store: 'Local parts market' }
        ] },
      { id: uid(), name: 'Front ABS Wheel Speed Sensor', icon: '📡', cat: 'Electrical', partsouq: 'BJS74370XA',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: 'BJS7-43-70XA', price: 220, store: 'Mazda Dealer (Alireza)', note: 'ABS / traction / brake warning light on = replace' },
          { tag: 'ALT', brand: 'Aftermarket sensor', partNo: '', price: 90, store: 'Amazon.sa' }
        ] },
      { id: uid(), name: 'Engine Coolant Temp Sensor (ECT)', icon: '🌡️', cat: 'Engine', partsouq: 'SH0118840',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine', partNo: 'SH01-18-840', price: 110, store: 'Mazda Dealer (Alireza)', note: 'CEL / wrong temp reading / fan or fuel-trim issues = replace' },
          { tag: 'ALT', brand: 'Aftermarket sensor', partNo: '', price: 45, store: 'Amazon.sa' }
        ] },
      { id: uid(), name: 'Intake Manifold Gasket', icon: '🛢️', cat: 'Engine', partsouq: 'PE0113111',
        options: [
          { tag: 'OEM', brand: 'Mazda Genuine (per port)', partNo: 'PE01-13-111', price: 25, store: 'Mazda Dealer (Alireza)', note: 'Vacuum leak / rough idle — renew when servicing the intake' },
          { tag: 'ALT', brand: 'Aftermarket gasket set', partNo: '', price: 15, store: 'Amazon.sa' }
        ] }
  ];
}

/* Generic SkyActiv-G consumables — every model starts with these until its own
   OEM numbers are filled in. Numbers vary by model, so verify before buying. */
function sharedParts() {
  const P = (name, icon, cat, options) => ({ id: uid(), name, icon, cat, options });
  const D = 'Mazda Dealer (Alireza)', A = 'Amazon.sa';
  return [
    P('Engine Oil 5W-30 (4L)', '🛢️', 'Engine', [
      { tag: 'OEM', brand: 'Shell Helix Ultra SP 5W-30 (dexos1 Gen3)', partNo: '', price: 160, store: A, note: 'API SP / ILSAC GF-6A full synthetic' },
      { tag: 'ALT', brand: 'TotalEnergies Quartz 9000 5W-30', partNo: '', price: 150, store: 'noon' }]),
    P('Oil Filter', '🧽', 'Engine', [
      { tag: 'OEM', brand: 'Mazda Genuine (SkyActiv-G — commonly shared)', partNo: 'PE01-14-302A', price: 45, store: D, note: 'One filter fits most SkyActiv-G engines — verify' },
      { tag: 'ALT', brand: 'Denso 150-2010', partNo: '150-2010', price: 28, store: A }]),
    P('Fuel System Cleaner (additive)', '🧴', 'Engine', [
      { tag: 'ALT', brand: 'Liqui Moly / Techron DI cleaner', partNo: '', price: 45, store: A, note: 'Mandatory for direct-injection SkyActiv-G' }]),
    P('Engine Air Filter', '🌬️', 'Engine', [
      { tag: 'OEM', brand: 'Mazda Genuine (verify for your model)', partNo: '', price: 90, store: D },
      { tag: 'ALT', brand: 'Blue Print / WIX', partNo: '', price: 45, store: A }]),
    P('Cabin A/C Filter', '❄️', 'Interior', [
      { tag: 'OEM', brand: 'Mazda Genuine (verify for your model)', partNo: '', price: 80, store: D },
      { tag: 'ALT', brand: 'Denso Carbon Cabin', partNo: '', price: 45, store: A }]),
    P('Spark Plugs (each)', '⚡', 'Engine', [
      { tag: 'OEM', brand: 'Mazda / NGK Iridium (verify for your engine)', partNo: '', price: 70, store: D },
      { tag: 'ALT', brand: 'NGK / Denso Iridium', partNo: '', price: 50, store: A }]),
    P('Front Brake Pads', '🛑', 'Brakes', [
      { tag: 'OEM', brand: 'Mazda Genuine (verify for your model)', partNo: '', price: 300, store: D },
      { tag: 'ALT', brand: 'Akebono Ceramic', partNo: '', price: 200, store: A }]),
    P('Rear Brake Pads', '🛑', 'Brakes', [
      { tag: 'OEM', brand: 'Mazda Genuine (verify for your model)', partNo: '', price: 260, store: D },
      { tag: 'ALT', brand: 'Akebono Ceramic', partNo: '', price: 170, store: A }]),
    P('Brake Fluid (DOT 4)', '🩸', 'Brakes', [
      { tag: 'OEM', brand: 'Motul DOT 3 & 4', partNo: '', price: 35, store: A, note: '~1 L for a full flush' }]),
    P('Coolant FL22 (long-life)', '🌡️', 'Engine', [
      { tag: 'OEM', brand: 'Mazda Genuine FL22 Long Life', partNo: '0000-77-508E-20', price: 130, store: D }]),
    P('ATF FZ (per liter)', '⚙️', 'Drivetrain', [
      { tag: 'OEM', brand: 'Mazda Genuine ATF-FZ (only)', partNo: 'K020-W0-052E4', price: 60, store: D, note: '~4.5–4.7 L per drain' }]),
    P('Serpentine Belt', '🔗', 'Engine', [
      { tag: 'OEM', brand: 'Mazda Genuine (verify for your model)', partNo: '', price: 150, store: D },
      { tag: 'ALT', brand: 'Gates Micro-V', partNo: '', price: 90, store: A }]),
    P('12V Battery', '🔋', 'Electrical', [
      { tag: 'OEM', brand: 'Mazda Genuine', partNo: '', price: 480, store: D },
      { tag: 'ALT', brand: 'Varta Blue Dynamic', partNo: '', price: 360, store: 'Battery shop', note: 'Strong in heat' }]),
    P('Wiper Blades (pair)', '🌧️', 'Exterior', [
      { tag: 'ALT', brand: 'Bosch Aerotwin', partNo: '', price: 95, store: A }]),
    P('Windshield Washer Fluid (~2L)', '💦', 'Exterior', [
      { tag: 'ALT', brand: 'Ready-mix washer fluid', partNo: '', price: 15, store: 'noon' }])
  ];
}

/* Assemble a fresh vehicle profile from the catalogue. */
function buildProfile(modelId, engIdx, opts) {
  opts = opts || {};
  const m = CAR_MODELS.find(x => x.id === modelId) || CAR_MODELS[1];
  const [engine, oilL] = m.engines[engIdx || 0] || m.engines[0];
  const odo = opts.odometer != null ? opts.odometer : 0;
  const s = {
    car: { nickname: '', make: 'Mazda', model: m.model, year: opts.year || '', engine, transmission: 'Automatic',
      color: opts.color || DEFAULT_COLOR, plate: '', vin: '', photo: '', odometer: odo, dailyKm: 40 },
    budget: { annual: 6000 },
    services: skyactivServices(oilL),
    parts: modelId === 'mazda3bm' ? mazda3Parts() : sharedParts(),
    history: [], spending: [], fuel: [], docs: []
  };
  // baseline every service at the current odometer / today so the schedule tracks from now
  s.services.forEach(x => { x.lastKm = odo; x.lastDate = isoDate(today()); });
  return s;
}
// default first vehicle: the owner's 2016 Mazda 3 (BM · 2.0) at 316,000 km
function seed() { return buildProfile('mazda3bm', 0, { odometer: 316000, year: 2016, color: DEFAULT_COLOR }); }

/* ---------- state / storage ---------- */
/* ---------- multi-vehicle garage storage ----------
   garage = { vehicles: [{ id, data }], activeId }; `state` is the active vehicle's data,
   so the rest of the app keeps using state.car / state.services / … unchanged. */
const GKEY = 'garage.mazda3.v2';
let garage;
/* Guards navigation and chrome (tabs, settings, garage) until boot has
   hydrated `state`. A failed boot leaves this false so a stray tap can't
   clear the error card and crash into a blank screen on a null `state`. */
let booted = false;
/* Dealer "normal" intervals from the Haji Husein Alireza (Mazda KSA) sheet —
   the shorter values already in the app are the Jeddah "severe" schedule.
   [normalKm, normalMonths] keyed by built-in service name. */
const NORMAL_SCHED = {
  'Engine Oil & Filter': [10000, 12],
  'Cabin (A/C) Filter': [20000, 12],
  'Engine Air Filter': [40000, 24],
  'Fuel Filter': [120000, 72]
};
/* Community gearbox (ATF) guidance — the dealer sheet omits transmission service.
   Source: Mazda CX-5 group + info guide. */
const ATF_NOTE = 'Community rec. (Mazda CX-5 group + info guide): renew ATF every 60–80k km per gearbox condition. Mazda Genuine ATF-FZ only (K020-W0-052E4), ~4.5–4.7 L per drain — buy 5×1 L. Replace the pan filter (FZ01-21-500) and reseal the pan with silicone (Dirko HT / Reinzosil / Mopar — better than dealer sealant), applied cleanly. Go easy on the gearbox for the first ~800 km. Check the fluid level to spec. No additives.';
function atfFilterPart() {
  return { id: uid(), name: 'Transmission Fluid Filter', icon: '🧽', cat: 'Drivetrain', partsouq: 'FZ0121500', options: [
    { tag: 'OEM', brand: 'Mazda Genuine ATF pan filter', partNo: 'FZ01-21-500', price: 138, store: 'Mazda Dealer (Alireza)', note: 'Renew with every ATF change (community rec.)' }
  ] };
}
function atfSealantPart() {
  return { id: uid(), name: 'Transmission Pan Sealant', icon: '🧴', cat: 'Drivetrain', options: [
    { tag: 'ALT', brand: 'Elring Dirko HT (+315°C)', partNo: '', price: 55, store: 'Amazon.sa', note: 'Community pick — better than dealer sealant' },
    { tag: 'ALT', brand: 'Victor Reinz Reinzosil', partNo: '', price: 50, store: 'Amazon.sa' },
    { tag: 'ALT', brand: 'Mopar RTV Engine Sealant', partNo: '', price: 45, store: 'Local parts market' }
  ] };
}
function fuelSystemCleanerPart() {
  return { id: uid(), name: 'Fuel System Cleaner (additive)', icon: '🧪', cat: 'Engine', options: [
    { tag: 'OEM', brand: 'Dealer-applied treatment', partNo: '', price: 45, store: 'Mazda Dealer (Alireza)', note: 'Added at every oil change per dealer sheet' },
    { tag: 'ALT', brand: 'Chevron Techron Concentrate Plus', partNo: '', price: 55, store: 'Amazon.sa' },
    { tag: 'ALT', brand: 'Liqui Moly Fuel System Cleaner', partNo: '', price: 40, store: 'noon' }
  ] };
}
function normalizeData(s) {
  s.car = Object.assign({ nickname: '', vin: '', photo: '' }, s.car);
  ['services', 'parts', 'history', 'spending', 'fuel', 'docs'].forEach(k => { if (!Array.isArray(s[k])) s[k] = []; });
  // When the odometer was last known good. Derived from data on disk — not
  // from today() — because normalizeData runs on every load and is only
  // persisted when something calls save().
  if (!s.car.odoUpdatedAt) {
    const seen = [].concat(s.fuel.map(f => f.date), s.history.map(h => h.date)).filter(Boolean).sort();
    s.car.odoUpdatedAt = seen.length ? seen[seen.length - 1] : isoDate(today());
  }
  if (typeof s.planSetupDone !== 'boolean') s.planSetupDone = false;
  if (s.severity !== 'normal' && s.severity !== 'severe') s.severity = 'severe'; // Jeddah default
  // Fuel System Cleaner is now a PART of every oil change (mandatory for the direct-injection
  // SkyActiv-G), not a standalone service. Retire the old standalone line and fold its cost
  // into the oil change. Idempotent — only fires while the standalone still exists.
  const fscIdx = s.services.findIndex(sv => sv.name === 'Fuel System Cleaner');
  if (fscIdx >= 0) {
    s.services.splice(fscIdx, 1);
    const oil = s.services.find(sv => sv.name === 'Engine Oil & Filter');
    if (oil) oil.cost = Number(oil.cost || 0) + 45;
  }
  if (!s.parts.some(p => p.name === 'Fuel System Cleaner (additive)')) s.parts.push(fuelSystemCleanerPart());
  s.services.forEach(sv => { // seed dealer intervals where they differ from severe
    if (sv.normalKm == null && NORMAL_SCHED[sv.name]) { sv.normalKm = NORMAL_SCHED[sv.name][0]; sv.normalMonths = NORMAL_SCHED[sv.name][1]; }
  });
  // community gearbox (ATF) guidance — idempotent, reaches existing vehicles too
  const atf = s.services.find(sv => sv.name === 'Automatic Transmission Fluid');
  if (atf) {
    if (atf.normalKm == null) { atf.normalKm = 80000; atf.normalMonths = 72; } // 60k severe → 80k community max
    if (!/4\.5/.test(atf.note || '')) atf.note = ATF_NOTE;
  }
  if (!s.parts.some(p => p.name === 'Transmission Fluid Filter')) s.parts.push(atfFilterPart());
  if (!s.parts.some(p => p.name === 'Transmission Pan Sealant')) s.parts.push(atfSealantPart());
  return s;
}
/* active interval for the current schedule basis (severe = the app's own values;
   normal = the dealer values where a service defines them, else the same) */
function svKm(s) { return (state.severity === 'normal' && s.normalKm) ? s.normalKm : s.intervalKm; }
function svMo(s) { return (state.severity === 'normal' && s.normalMonths) ? s.normalMonths : s.intervalMonths; }
/* Phase 2: persistence is async and may be backed by IndexedDB or
   localStorage. Reads stay synchronous — the whole garage is hydrated into
   `state` at boot — so page code is unchanged. */
let state = null;
let photoBlobs = {};   // photo id -> Blob, for the active session

/* Object URLs created for stored photo Blobs. The app has no view-teardown
   hook — go() replaces innerHTML wholesale — so these are revoked at the
   start of each navigation (Task 4). Without that the app leaks one URL per
   photo per render. */
let liveObjectUrls = [];
function objectUrl(blob) {
  const url = URL.createObjectURL(blob);
  liveObjectUrls.push(url);
  return url;
}
function revokeObjectUrls() {
  liveObjectUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
  liveObjectUrls = [];
}

function hydrate(garage, photos) {
  if (!garage || !Array.isArray(garage.vehicles) || !garage.vehicles.length) {
    // Pre-garage single-car data still living under STORE_KEY is this user's
    // only copy — seed from it before falling back to a blank car.
    const legacy = readLegacyV1();
    garage = { vehicles: [{ id: uid(), data: normalizeData(legacy || seed()) }], activeId: null };
    garage.activeId = garage.vehicles[0].id;
  }
  garage.vehicles.forEach(v => {
    normalizeData(v.data);
    resolvePhotos(v.data, photos);
  });
  const active = garage.vehicles.find(v => v.id === garage.activeId) || garage.vehicles[0];
  garage.activeId = active.id;
  return { garage, state: active.data };
}

/* Turn stored photo ids into object URLs so `.photo` keeps working in every
   render path. Registered for revocation on the next navigation. */
function resolvePhotos(data, photos) {
  const slots = [data.car].concat(data.history || [], data.spending || []).filter(Boolean);
  slots.forEach(o => {
    if (o.photoId && photos[o.photoId]) o.photo = objectUrl(photos[o.photoId]);
  });
}

/* Re-create object URLs after a revocation sweep. Must cover EVERY vehicle:
   revokeObjectUrls() is indiscriminate, and the garage switcher renders photos
   for vehicles that are not active. */
function refreshPhotoUrls() {
  if (!garage || !photoBlobs) return;
  garage.vehicles.forEach(v => resolvePhotos(v.data, photoBlobs));
}

function save() {
  const v = garage.vehicles.find(x => x.id === garage.activeId);
  if (!v) return Promise.resolve(false);
  v.data = state;
  const data = state;          // the vehicle being saved — `state` may move before this resolves
  return saveVehicle(v.id, data, garage.activeId, uid).then(res => {
    if (res.ok) {
      applyPhotoIds(data, res.data);
      cacheNewPhotos(data, res.photoIds);
      return true;
    }
    const err = res.error;
    toast(isQuotaError(err)
      ? t('Storage is full — your change was NOT saved. Remove some receipt photos.')
      : t('Could not save your change.'), 'warn');
    return false;
  });
}

/* applyPhotoIds lives in storage.js with the rest of the pure record
   transforms, so the id-matching it depends on is covered by the tests. */

/* Keep just-saved images in the session cache so later navigations render
   them from a Blob like every other photo, instead of a lingering data URL. */
function cacheNewPhotos(live, photoIds) {
  if (!photoIds || !photoIds.length) return;
  const slots = [live.car].concat(live.history || [], live.spending || []).filter(Boolean);
  slots.forEach(o => {
    if (o.photoId && photoIds.indexOf(o.photoId) >= 0 && !photoBlobs[o.photoId]) {
      const blob = dataUrlToBlob(o.photo);
      if (blob) photoBlobs[o.photoId] = blob;
    }
  });
}
function switchVehicle(id) {
  closeModal();
  const v = garage.vehicles.find(x => x.id === id); if (!v) return;
  garage.activeId = id; state = v.data; save();
  applyAccent(); renderTopbar(); go('dashboard');
}
function addVehicle() { openAddVehicle(); }
function openAddVehicle() {
  openModal('Add a Mazda', 'Pick the model and engine — its SkyActiv service plan is set up for you.', card => {
    card.appendChild(field('Model', `<select id="av_model">${CAR_MODELS.map((m, i) => `<option value="${i}">Mazda ${m.model} · ${m.gen}</option>`).join('')}</select>`));
    const engField = field('Engine', `<select id="av_eng"></select>`);
    card.appendChild(engField);
    const r = el('div', 'field-row');
    r.append(field('Current odometer (km)', `<input id="av_odo" type="number" inputmode="numeric" value="0">`),
      field('Year', `<input id="av_year" type="number" inputmode="numeric" placeholder="${t('e.g. 2019')}">`));
    card.appendChild(r);
    const modelSel = card.querySelector('#av_model'), engSel = card.querySelector('#av_eng');
    const fillEngines = () => { engSel.innerHTML = CAR_MODELS[+modelSel.value].engines.map((e, i) => `<option value="${i}">${e[0]}</option>`).join(''); };
    modelSel.value = '1'; fillEngines();          // default to Mazda 3 BM
    modelSel.onchange = fillEngines;
    const b = el('button', 'btn primary block', t('Add a vehicle'));
    b.onclick = async () => {
      const m = CAR_MODELS[+modelSel.value];
      const data = normalizeData(buildProfile(m.id, +engSel.value, { odometer: +$('#av_odo').value || 0, year: +$('#av_year').value || '' }));
      const v = { id: uid(), data };
      garage.vehicles.push(v); garage.activeId = v.id; state = v.data;
      const res = await saveVehicle(v.id, v.data, garage.activeId, uid);
      const ok = res.ok;
      if (ok) applyPhotoIds(v.data, res.data);
      applyAccent(); renderTopbar(); closeModal(); go('dashboard');
      if (ok) toast(t('Vehicle added'));
      else toast(isQuotaError(res.error)
        ? t('Storage is full — your change was NOT saved. Remove some receipt photos.')
        : t('Could not save your change.'), 'warn');
    };
    card.appendChild(b);
  });
}
async function deleteVehicle(id) {
  if (garage.vehicles.length <= 1) { toast('Keep at least one vehicle', 'warn'); return; }
  garage.vehicles = garage.vehicles.filter(v => v.id !== id);
  if (garage.activeId === id) { garage.activeId = garage.vehicles[0].id; state = garage.vehicles[0].data; }
  const ok = await removeVehicle(id, garage.activeId); applyAccent(); renderTopbar(); go('dashboard');
  if (ok) toast('Vehicle removed');
  else toast(t('Could not save your change.'), 'warn');
}
function vehicleName(c) { return c.nickname || [c.year, c.make, c.model].filter(Boolean).join(' ') || 'Vehicle'; }

/* A backup the user controls, before any server exists. Photos are inlined
   as base64 so a single file is the whole garage. */
async function exportGarage() {
  const photos = {};
  await Promise.all(Object.keys(photoBlobs).map(async id => { photos[id] = await blobToDataUrl(photoBlobs[id]); }));
  const payload = buildExport(garage, photos, new Date().toISOString());
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `garage-backup-${isoDate(today())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(t('Backup downloaded'));
}

/* Import **replaces** the garage. It must ask first — this is destructive. */
function importGarage(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    const parsed = parseImport(reader.result);
    if (!parsed.ok) return toast(t(parsed.error), 'warn');
    if (!confirm(t('Importing replaces everything currently in your garage. Continue?'))) return;
    // Past this point `garage` and `photoBlobs` are replaced in place, so any
    // throw would strand the running app on a half-restored garage with no
    // toast. parseImport validates the shape; this catches everything else.
    try {
      const priorIds = garage.vehicles.map(v => v.id);
      garage = parsed.garage;
      photoBlobs = {};
      Object.keys(parsed.photos).forEach(id => {
        const blob = dataUrlToBlob(parsed.photos[id]);
        if (blob) photoBlobs[id] = blob;
      });
      // The backup's .photo fields are stale blob: URLs from the exporting session.
      // Restore real data: URLs from the backup's own photos dict, or splitPhotos
      // will treat them as already-stored and persist nothing.
      garage.vehicles.forEach(v => {
        // A backup from the localStorage backend carries its images inline; one from
        // IndexedDB carries them in `photos` with stale blob: URLs in the records.
        // Merge both so neither origin loses data. collectInlinePhotos ignores blob: URLs.
        const merged = Object.assign(collectInlinePhotos(v.data), parsed.photos);
        v.data = inlinePhotos(v.data, merged);
        normalizeData(v.data);
      });
      const active = garage.vehicles.find(v => v.id === garage.activeId) || garage.vehicles[0];
      garage.activeId = active.id;
      state = active.data;
      let ok = true;
      for (const v of garage.vehicles) {
        const res = await saveVehicle(v.id, v.data, garage.activeId, uid);
        if (!res.ok) ok = false;
      }
      // The user confirmed a replace, not a merge — drop vehicles the backup does not contain.
      const keptIds = garage.vehicles.map(v => v.id);
      for (const id of priorIds) {
        if (keptIds.indexOf(id) < 0) await removeVehicle(id, garage.activeId);
      }
      // The save loop minted fresh photo ids, so re-read from storage to bring
      // memory back in sync with what was actually persisted.
      const fresh = await loadAll();
      const h = hydrate(fresh.garage, fresh.photos);
      garage = h.garage;
      state = h.state;
      photoBlobs = fresh.photos || {};
      closeModal();
      applyAccent(); renderTopbar(); go('dashboard');
      toast(ok ? t('Garage restored') : t('Restored, but some data could not be saved'), ok ? undefined : 'warn');
    } catch (err) {
      console.error(err);
      toast(t('That backup could not be restored. Please reload the page.'), 'warn');
    }
  };
  reader.onerror = () => toast(t('Could not read that file.'), 'warn');
  reader.readAsText(file);
}

/* ---------- service status computation ---------- */
function serviceStatus(s) {
  const odo = state.car.odometer;
  const ikm = svKm(s), imo = svMo(s);
  const dueKm = s.lastKm + ikm;
  const kmLeft = dueKm - odo;
  const dueDate = addMonths(parseDate(s.lastDate), imo);
  const daysLeft = Math.round((dueDate - today()) / 86400000);
  // progress through the interval (0..1+), take the more advanced of km/time
  const kmProg = (odo - s.lastKm) / ikm;
  const timeProg = monthsBetween(parseDate(s.lastDate), today()) / imo;
  const prog = Math.max(kmProg, timeProg);
  // which dimension is driving the due?
  const drivenByTime = timeProg >= kmProg;
  let level = 'ok';
  if (kmLeft <= 0 || daysLeft <= 0) level = 'danger';
  else if (kmLeft <= 1200 || daysLeft <= 30) level = 'warn';
  return { dueKm, kmLeft, dueDate, daysLeft, prog: clamp(prog, 0, 1.2), level, drivenByTime };
}
function servicesRanked() {
  return state.services
    .map(s => ({ s, st: serviceStatus(s) }))
    .sort((a, b) => a.st.prog === b.st.prog ? a.st.kmLeft - b.st.kmLeft : b.st.prog - a.st.prog);
}
function healthScore() {
  return healthFrom(state.services.map(s => serviceStatus(s).level));
}
/* What is dragging the score down — a bare number is not actionable. */
function openHealthBreakdown() {
  const bad = servicesRanked().filter(r => r.st.level !== 'ok');
  openModal('Health score', `${healthScore()} / 100 — ${t('what is affecting it')}`, card => {
    if (!bad.length) { card.appendChild(emptyState('✅', 'Everything is on track.')); return; }
    const list = el('div', 'list');
    bad.forEach(({ s, st }) => list.appendChild(serviceItem(s, st)));
    card.appendChild(list);
  });
}
function yearSpend(year) {
  return state.spending.filter(e => e.date.startsWith(String(year))).reduce((a, e) => a + Number(e.amount), 0);
}

/* ============================================================
   ROUTER
   ============================================================ */
const routes = { dashboard: renderDashboard, maintenance: renderMaintenance, parts: renderParts, fuel: renderFuel, budget: renderBudget, reports: renderReports };
let current = 'dashboard';
let navIntent = null; // cross-page link target, consumed by the destination page's render
function go(route, intent) {
  if (!booted) return;      // boot failed — leave the error card in place
  revokeObjectUrls();
  refreshPhotoUrls();
  renderTopbar();     // the badge lives outside #view; its URL was just revoked
  current = route;
  navIntent = intent || null;
  const view = $('#view');
  view.className = 'view ' + route;
  view.innerHTML = '';
  view.appendChild(routes[route]());
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.route === route));
  $('#view').scrollTop = 0;
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => go(t.dataset.route)));

/* ---------- cross-page links: which parts each service consumes ---------- */
const SERVICE_PARTS = {
  'Engine Oil & Filter': ['Engine Oil 5W-30 (4L)', 'Oil Filter', 'Fuel System Cleaner (additive)'],
  'Engine Air Filter': ['Engine Air Filter'],
  'Cabin (A/C) Filter': ['Cabin A/C Filter'],
  'Spark Plugs (x4)': ['Spark Plugs (each)'],
  'Brake Fluid': ['Brake Fluid (DOT 4)'],
  'Engine Coolant (FL22)': ['Coolant FL22 (long-life)'],
  'Automatic Transmission Fluid': ['ATF FZ (per liter)', 'Transmission Fluid Filter', 'Transmission Pan Sealant'],
  'Drive (Serpentine) Belt': ['Serpentine Belt'],
  'Battery Check': ['12V Battery'],
  'Brake Inspection & Caliper Lube': ['Front Brake Pads', 'Rear Brake Pads']
};
const partCheapest = p => Math.min(...p.options.map(o => o.price));
function partsForService(s) { return (SERVICE_PARTS[s.name] || []).map(n => state.parts.find(p => p.name === n)).filter(Boolean); }
function servicesForPart(p) { return state.services.filter(s => (SERVICE_PARTS[s.name] || []).includes(p.name)); }

/* How mandatory a part is for the car's health — drives the "do it next time"
   warning when a part is skipped (marked None). high = safety/engine-critical. */
const CRIT_HIGH = new Set(['Engine Oil 5W-30 (4L)', 'Oil Filter', 'Fuel System Cleaner (additive)', 'Front Brake Pads', 'Rear Brake Pads', 'Brake Fluid (DOT 4)', 'Front Brake Disc (each)', 'Rear Brake Disc (each)', 'Coolant FL22 (long-life)', 'ATF FZ (per liter)', 'Transmission Fluid Filter', 'Spark Plugs (each)', 'Timing Chain Kit', 'Water Pump', 'Serpentine Belt']);
const CRIT_LOW = new Set(['Cabin A/C Filter', 'Wiper Blades (pair)', 'Windshield Washer Fluid (~2L)', 'Headlight Bulbs (H11 low · 9005 high)', 'Tail / Brake Light Bulbs', 'Transmission Pan Sealant']);
function partCrit(name) { return CRIT_HIGH.has(name) ? 'high' : CRIT_LOW.has(name) ? 'low' : 'med'; }
const critLevel = name => partCrit(name) === 'high' ? 'danger' : partCrit(name) === 'med' ? 'warn' : 'ok';
const critLabel = name => partCrit(name) === 'high' ? t('mandatory') : partCrit(name) === 'low' ? t('optional') : t('recommended');

/* ============================================================
   PAGE 1 — DASHBOARD
   ============================================================ */
function renderDashboard() {
  const v = el('div');
  const ranked = servicesRanked();
  const overdue = ranked.filter(r => r.st.level === 'danger');
  const soon = ranked.filter(r => r.st.level === 'warn');
  const hs = healthScore();
  const spent = yearSpend(today().getFullYear());
  const budget = state.budget.annual;

  // Car photo — its own container / banner
  const carName = state.car.nickname || [state.car.year, state.car.make, state.car.model].filter(Boolean).join(' ');
  const carCard = el('button', 'card car-card' + (state.car.photo ? '' : ' empty'));
  carCard.title = state.car.photo ? t('Change car photo') : t('Add a photo of your car');
  carCard.innerHTML = state.car.photo
    ? `<img src="${state.car.photo}" alt="Your ${carName}"><div class="car-card-grad"></div><div class="car-card-cap">${carName}</div>`
    : `<span class="cpb-ph"><span class="cpb-emoji">🚗</span><small>${t('Add a photo of your car')}</small></span>`;
  carCard.onclick = openSettings;
  const topRow = el('div', 'top-row');
  topRow.appendChild(carCard);

  // hero + ring
  const hero = el('div', 'card hero');
  const dash = 2 * Math.PI * 40;
  hero.innerHTML = `
    <div>
      <div class="odo-label">${t('Odometer')}</div>
      <div class="odo-value">${fmt(state.car.odometer)}<span>km</span></div>
      <button class="odo-edit" id="editOdo">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
        ${t('Update mileage')}
      </button>
    </div>
    <div class="ring">
      <svg viewBox="0 0 92 92">
        <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${hs >= 70 ? '#23c186' : hs >= 45 ? '#f5a623' : '#ff4d5e'}"/>
          <stop offset="1" stop-color="${hs >= 70 ? '#4be0a6' : hs >= 45 ? '#ffce6b' : '#ff8a95'}"/>
        </linearGradient></defs>
        <circle class="track" cx="46" cy="46" r="40" fill="none" stroke-width="8"/>
        <circle class="prog" cx="46" cy="46" r="40" fill="none" stroke-width="8"
          stroke-dasharray="${dash}" stroke-dashoffset="${dash * (1 - hs / 100)}"/>
      </svg>
      <div class="ring-label"><div class="ring-num">${hs}</div><div class="ring-cap">${t('Health')}</div></div>
    </div>`;
  topRow.appendChild(hero);
  v.appendChild(topRow);

  // tiles — each links to the page it summarizes
  const tiles = el('div', 'tiles');
  tiles.innerHTML = `
    <div class="tile ${soon.length ? 'warn' : 'ok'}"><div class="t-num">${soon.length}</div><div class="t-cap">${t('Due soon')}</div></div>
    <div class="tile ${overdue.length ? 'danger' : 'ok'}"><div class="t-num">${overdue.length}</div><div class="t-cap">${t('Overdue')}</div></div>
    <div class="tile"><div class="t-num">${sar(spent)}</div><div class="t-cap">${t('SAR this year')}</div></div>`;
  tiles.children[0].onclick = () => go('maintenance', { filter: 'Due soon' });
  tiles.children[1].onclick = () => go('maintenance', { filter: 'Overdue' });
  tiles.children[2].onclick = () => go('budget');
  [...tiles.children].forEach(t => { t.style.cursor = 'pointer'; });
  v.appendChild(tiles);

  // Stale mileage quietly corrupts every due date — nudge, don't nag.
  const odoAge = daysSince(state.car.odoUpdatedAt, today());
  if (odoAge >= 14) {
    const ob = el('button', 'card reminder-banner warn');
    ob.innerHTML = `<span class="rb-ic">📏</span><span class="rb-text">${t('Mileage is {n} days old — due dates may be off').replace('{n}', odoAge === Infinity ? '?' : odoAge)}</span><span class="rb-go">${t('Update ›')}</span>`;
    ob.onclick = openEditOdo;
    v.appendChild(ob);
  }

  // Reminder — services you marked "not yet" during a plan visit, ranked by severity
  const deferred = ranked.filter(r => r.s.deferred);
  if (deferred.length) {
    const worst = deferred.some(r => r.st.level === 'danger') ? 'danger' : deferred.some(r => r.st.level === 'warn') ? 'warn' : 'ok';
    const rb = el('button', 'card reminder-banner ' + worst);
    rb.innerHTML = `<span class="rb-ic">⏰</span><span class="rb-text"><b>${deferred.length}</b> ${t(deferred.length === 1 ? 'service to catch up' : 'services to catch up')}</span><span class="rb-go">${t('Log ›')}</span>`;
    rb.onclick = () => openLogConfirm(deferred.map(r => r.s), { checklist: true, title: 'Catch up', onDone: () => go('dashboard') });
    v.appendChild(rb);
  }

  // Next up — top services due this year (overdue/due-soon and deferred always count)
  const thisYear = today().getFullYear();
  v.appendChild(sectionTitle('Next up', 'See all', () => go('maintenance'), String(thisYear)));
  const dueThisYear = ranked.filter(r => r.s.deferred || r.st.level !== 'ok' || r.st.dueDate.getFullYear() <= thisYear);
  const list = el('div', 'list');
  dueThisYear.slice(0, 4).forEach(({ s, st }) => list.appendChild(serviceItem(s, st)));
  if (!dueThisYear.length) list.appendChild(emptyState('🎉', 'Nothing here — all good!'));
  v.appendChild(list);

  // Documents & renewals (insurance, Istimara, license…)
  v.appendChild(sectionTitle('Documents & renewals', 'Add', () => openAddDoc(null)));
  const docsList = el('div', 'list');
  const docs = [...(state.docs || [])].sort((a, b) => (a.expiry ? +parseDate(a.expiry) : Infinity) - (b.expiry ? +parseDate(b.expiry) : Infinity));
  if (!docs.length) docsList.appendChild(emptyState('📄', 'No documents yet.\nAdd insurance, Istimara or license expiry.'));
  docs.forEach(d => docsList.appendChild(docItem(d)));
  v.appendChild(docsList);

  // quick actions
  const row = el('div', 'fab-row');
  const bLog = el('button', 'btn primary block', iconSvg('check') + t('Log a service'));
  bLog.onclick = () => openLogService();
  const bSpend = el('button', 'btn block', iconSvg('plus') + t('Add spending'));
  bSpend.onclick = () => openAddSpending();
  row.append(bLog, bSpend);
  v.appendChild(row);

  // Recommendations (dashboard only)
  v.appendChild(sectionTitle('Recommendations', '', null));
  const recs = el('div', 'list');
  recommendations().forEach(r => recs.appendChild(r));
  v.appendChild(recs);

  hero.querySelector('#editOdo').onclick = openEditOdo;
  const ring = hero.querySelector('.ring');
  ring.setAttribute('role', 'button');
  ring.setAttribute('tabindex', '0');
  ring.setAttribute('aria-label', `${t('Health')} ${hs} — ${t('what is affecting it')}`);
  ring.onclick = openHealthBreakdown;
  ring.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openHealthBreakdown(); } };
  return v;
}

/* ============================================================
   PAGE 2 — MAINTENANCE
   ============================================================ */
/* ---------- forward service plan (upcoming milestones, adapted to the car) ----------
   Built from THIS vehicle's own services and their ACTUAL last-done point, so it
   fits any car, projects forward from the current odometer, and self-adjusts when
   a service was done off its recommended interval. Each service's future due points
   (lastKm + n·interval) are computed at their true due distance, then merged into
   workshop visits whenever two due points fall within MILESTONE_TOLERANCE_KM of each
   other (see mergeMilestones in schedule.js) — never onto a fixed distance grid, and
   never merging a service into a milestone it is already part of. Every milestone
   carries a projected calendar date from the car's average driving. */
const MILESTONE_TOLERANCE_KM = 1000; // services this close share one workshop visit
function planForward() {
  const odo = state.car.odometer || 0;
  const dpk = state.car.dailyKm || 40;
  const horizon = odo + 300000; // far enough that recurring services (ATF 60–80k, etc.) repeat for years
  const occurrences = [];
  state.services.filter(s => svKm(s) > 0).forEach(s => {
    const ikm = svKm(s);
    let k = serviceStatus(s).dueKm;   // first upcoming due (lastKm + interval)
    if (k < odo) {                    // overdue → due now, then continue strictly after odo
      occurrences.push({ km: odo, service: s });
      k = nextOverdueOccurrence(k, odo, ikm);
    }
    for (; k <= horizon; k += ikm) occurrences.push({ km: k, service: s });
  });
  return mergeMilestones(occurrences, MILESTONE_TOLERANCE_KM).map(ms => ({
    km: ms.km,
    items: ms.items,
    major: ms.items.some(s => svKm(s) >= 60000),
    date: new Date(today().getTime() + Math.max(0, (ms.km - odo) / dpk) * 86400000)
  }));
}

let maintMode = 'Schedule'; // remembered across renders in the session
function renderMaintenance() {
  if (navIntent && navIntent.filter) maintMode = 'Schedule'; // a cross-page link targets the schedule
  const v = el('div');
  v.appendChild(pageIntro('Maintenance', 'Your service schedule and full work history — tracked by distance and time.'));

  const modeSeg = el('div', 'seg');
  ['Schedule', 'Plan', 'History'].forEach(m => {
    const b = el('button', m === maintMode ? 'on' : '', t(m));
    b.onclick = () => { if (maintMode === m) return; maintMode = m; [...modeSeg.children].forEach(c => c.classList.toggle('on', c === b)); paintMode(); };
    modeSeg.appendChild(b);
  });
  v.appendChild(modeSeg);

  // schedule basis (Jeddah severe vs. dealer normal) is chosen once in the
  // plan setup wizard, not toggled here — see openPlanSetup().
  const body = el('div');
  function paintMode() {
    body.innerHTML = '';
    (maintMode === 'History' ? buildHistory : maintMode === 'Plan' ? buildPlan : buildSchedule)(body);
  }
  v.appendChild(body);
  paintMode();
  return v;
}

function buildPlan(v) {
  const intro = el('p');
  intro.style.cssText = 'font-size:12.5px;line-height:1.55;color:var(--text-2);margin:2px 4px 14px';
  intro.textContent = t('What’s coming up, built from your own services and when each was last done. Tap a task to log it, or log a whole visit.');
  v.appendChild(intro);

  const all = planForward();
  // A rolling 24-month window — a calendar-year filter made this view empty
  // out every December. Always at least three milestones.
  const cutoff = new Date(today());
  cutoff.setMonth(cutoff.getMonth() + 24);
  const shown = withinHorizon(all, cutoff, 3);

  const wrap = el('div', 'plan-list');
  let lastYear = null;
  shown.forEach((ms, idx) => {
    const yr = ms.date.getFullYear();
    if (yr !== lastYear) { wrap.appendChild(el('div', 'plan-year', String(yr))); lastYear = yr; }
    const isNext = idx === 0;
    const card = el('div', 'card plan-ms' + (ms.major ? ' major' : '') + (isNext ? ' next' : ''));
    card.innerHTML = `
      <div class="plan-ms-head">
        <div class="plan-km">${fmt(ms.km)}<span>km</span></div>
        <div class="plan-meta">
          ${isNext ? `<span class="plan-badge next">${t('Next up')}</span>` : ''}
          ${ms.major ? `<span class="plan-badge">${t('Major service')}</span>` : ''}
          <span class="plan-when">≈ ${ms.date.toLocaleDateString('en', { month: 'short', year: 'numeric' })}</span>
        </div>
      </div>
      <div class="plan-items">
        ${ms.items.map((s, i) => `<button class="plan-chip" data-i="${i}"><i>${s.icon || '🔧'}</i>${t(s.name)}</button>`).join('')}
      </div>
      <button class="plan-log">${iconSvg('check')}${t('Log this visit')}</button>`;
    card.querySelectorAll('.plan-chip').forEach(btn => btn.onclick = () => {
      const s = ms.items[+btn.dataset.i];
      openLogConfirm([s], { checklist: true, onDone: () => { go('maintenance'); } });
    });
    card.querySelector('.plan-log').onclick = () => openLogConfirm(ms.items, { checklist: true, onDone: () => { go('maintenance'); } });
    wrap.appendChild(card);
  });
  if (!shown.length) wrap.appendChild(emptyState('🗓️', 'Nothing scheduled — you’re all caught up!'));
  v.appendChild(wrap);

  const note = el('div', 'card');
  note.style.cssText = 'padding:13px 15px;margin-top:12px;font-size:12px;line-height:1.55;color:var(--text-2)';
  note.innerHTML = `💡 ${t('This adapts to when you actually service the car — log a task off its usual interval and the plan re-times itself. Edit intervals under Schedule.')}`;
  v.appendChild(note);
}

// Log a whole visit as done NOW (at the current odometer) — resets those services' clocks.
function logVisit(ms) {
  const date = isoDate(today());
  const odo = state.car.odometer || 0;
  let total = 0;
  ms.items.forEach(s => {
    s.lastKm = odo;
    s.lastDate = date;
    state.history.push({ id: uid(), name: s.name, icon: s.icon || '🔧', date, odometer: odo, cost: s.cost || 0, cat: 'Maintenance', note: '' });
    total += Number(s.cost || 0);
  });
  if (total > 0) state.spending.push({ id: uid(), date, cat: 'Maintenance', desc: `${t('Service visit')} · ${fmt(odo)} km`, amount: total, odometer: odo });
  save(); // fire-and-forget: nothing downstream reads the result
}

/* Confirm-and-log a service or a whole plan visit, letting the user choose which
   catalogue part (OEM or Alternative) they actually used for each linked part.
   The picked option's price drives the cost; any labour baked into the service's
   estimate (est. cost − default parts) is preserved. */
function openLogConfirm(services, opts) {
  opts = opts || {};
  const checklist = opts.checklist || services.length > 1; // per-service Done / Not yet toggles
  const defIdx = p => { const i = p.options.findIndex(o => o.tag === 'OEM'); return i >= 0 ? i : 0; };
  const laborShare = svc => { const lp = partsForService(svc); if (!lp.length) return 0; const dflt = lp.reduce((a, p) => a + Number(p.options[defIdx(p)].price || 0), 0); return Math.max(0, Number(svc.cost || 0) - dflt); };
  const doneState = new Map(); services.forEach(s => doneState.set(s.id, true));
  openModal(opts.title || (services.length > 1 ? 'Log a plan visit' : services[0].name),
    opts.sub || 'Pick the parts you used (OEM or alternative), then log it.', card => {
      const r = el('div', 'field-row');
      r.append(field('Odometer (km)', `<input id="lc_odo" type="number" value="${opts.odometer != null ? opts.odometer : state.car.odometer}">`),
        field('Date', `<input id="lc_date" type="date" value="${isoDate(today())}">`));
      card.appendChild(r);

      const picks = new Map(); // `${part.id}:${svc.id}` -> <select>
      services.forEach(svc => {
        const lp = partsForService(svc);
        const container = el('div', 'card log-svc');           // each service in its own container
        const head = el('div', 'log-svc-head');
        head.innerHTML = `<div class="log-svc-title">${svc.icon || '🔧'} ${t(svc.name)}</div>`;
        const body = el('div', 'log-svc-body');
        const note = el('div', 'log-svc-note');
        note.textContent = '↪ ' + t('Carried to your next visit');
        note.style.display = 'none';

        if (svc.pendingParts && svc.pendingParts.length) {  // parts marked None last time
          const worst = svc.pendingParts.some(n => partCrit(n) === 'high') ? 'danger' : svc.pendingParts.some(n => partCrit(n) === 'med') ? 'warn' : 'ok';
          const pw = el('div', 'log-pending ' + worst);
          pw.innerHTML = `⚠️ ${t('Skipped last time — do it now')}: ` + svc.pendingParts.map(n => `${t(n)} <span class="crit">(${critLabel(n)})</span>`).join('، ');
          body.appendChild(pw);
        }
        if (!lp.length) {
          const d = el('div', 'muted'); d.style.cssText = 'font-size:12px;margin:8px 2px 0';
          d.textContent = `${t('No linked parts')} · ${sar(svc.cost || 0)} SAR`;
          body.appendChild(d);
        }
        lp.forEach(p => {
          const optsHtml = `<option value="none">— ${t('None — not done')} —</option>` + p.options.map((o, i) => `<option value="${i}">${o.tag} · ${o.brand} · ${sar(o.price)} SAR</option>`).join('');
          const f = field(t(p.name), `<select>${optsHtml}</select>`);
          const sel = f.querySelector('select');
          sel.value = String(defIdx(p));
          sel.onchange = recalc;
          picks.set(p.id + ':' + svc.id, { svc, part: p, sel });
          body.appendChild(f);
        });

        if (checklist) {
          const toggle = el('div', 'seg log-toggle');
          [['done', 'Done'], ['skip', 'Not yet']].forEach(([code, label]) => {
            const btn = el('button', code === 'done' ? 'on' : '', t(label));
            btn.onclick = () => {
              const isDone = code === 'done';
              doneState.set(svc.id, isDone);
              [...toggle.children].forEach(c => c.classList.toggle('on', c === btn));
              body.style.display = isDone ? '' : 'none';
              note.style.display = isDone ? 'none' : '';
              recalc();
            };
            toggle.appendChild(btn);
          });
          head.appendChild(toggle);
        }
        container.append(head, body, note);
        card.appendChild(container);
      });

      const totalEl = el('div');
      totalEl.style.cssText = 'font-weight:750;font-size:14px;margin:12px 2px 2px';
      function svcCost(svc) {
        const lp = partsForService(svc);
        if (!lp.length) return Number(svc.cost || 0);
        let sum = 0; lp.forEach(p => { const v = picks.get(p.id + ':' + svc.id).sel.value; sum += v === 'none' ? 0 : Number(p.options[+v].price || 0); });
        return sum + laborShare(svc);
      }
      function recalc() { totalEl.textContent = `${t('Total')}: ${sar(services.filter(s => doneState.get(s.id) !== false).reduce((a, svc) => a + svcCost(svc), 0))} SAR`; }
      recalc();
      card.appendChild(totalEl);

      const b = el('button', 'btn primary block', iconSvg('check') + t('Log it'));
      b.onclick = async () => {
        const odo = +$('#lc_odo').value || state.car.odometer;
        const date = $('#lc_date').value || isoDate(today());
        let grand = 0, nDone = 0, nSkip = 0, nPartSkip = 0, lastName = 'Service';
        services.forEach(svc => {
          if (doneState.get(svc.id) === false) { svc.deferred = true; svc.deferredAt = date; nSkip++; return; }
          svc.lastKm = odo; svc.lastDate = date; svc.deferred = false;
          const chosen = [], skippedParts = [];
          partsForService(svc).forEach(p => {
            const v = picks.get(p.id + ':' + svc.id).sel.value;
            if (v === 'none') { skippedParts.push(p.name); return; }
            const o = p.options[+v]; chosen.push({ part: p.name, tag: o.tag, brand: o.brand, price: o.price });
          });
          const pend = new Set(svc.pendingParts || []);
          skippedParts.forEach(n => pend.add(n)); chosen.forEach(c => pend.delete(c.part));
          svc.pendingParts = [...pend]; nPartSkip += skippedParts.length;
          const cost = svcCost(svc); grand += cost; nDone++; lastName = svc.name;
          state.history.push({ id: uid(), name: svc.name, icon: svc.icon || '🔧', date, odometer: odo, cost, cat: 'Maintenance', note: '', parts: chosen });
        });
        if (grand > 0) state.spending.push({ id: uid(), date, cat: 'Maintenance', desc: nDone > 1 ? `${t('Service visit')} · ${fmt(odo)} km` : lastName, amount: grand, odometer: odo });
        if (odo > (state.car.odometer || 0)) state.car.odometer = odo;
        const ok = await save(); closeModal();
        (opts.onDone || (() => go('maintenance')))();
        if (ok) {
          if (nSkip) toast(`${nDone} ${t('logged')} · ${nSkip} ${t('carried forward')}`);
          else if (!opts.onDone) toast(t(nDone > 1 ? 'Visit logged ✓' : 'Service logged ✓'));
          if (nPartSkip) toast(`⚠️ ${nPartSkip} ${t('part(s) to redo next service')}`, 'warn');
        }
      };
      card.appendChild(b);
    });
}

/* Step-by-step wizard: one question at a time — schedule basis, odometer,
   then every service (majors first) — instead of one long form. Each
   service asks "have you done this, and at what km" so the plan can be
   built from real answers rather than the seed defaults. The dealer vs.
   Jeddah-severe schedule basis is decided here only; it's not shown as a
   toggle on the Maintenance page anymore. Major/regular grouping uses the
   base (severe) interval so it doesn't shift depending on the basis answer. */
function openPlanSetup() {
  const eligible = state.services.filter(s => s.intervalKm > 0);
  const majors = eligible.filter(s => s.intervalKm >= 40000).sort((a, b) => a.intervalKm - b.intervalKm);
  const regulars = eligible.filter(s => s.intervalKm < 40000).sort((a, b) => a.intervalKm - b.intervalKm);
  const services = [...majors, ...regulars];
  const answers = services.map(s => ({ s, choice: s.lastKm > 0 ? 'yes' : null, km: s.lastKm || '' }));
  let basis = state.severity === 'normal' ? 'normal' : 'severe';
  let odo = state.car.odometer || '';
  let driveUnit = 'day';
  let dailyKm = state.car.dailyKm || 40;
  let step = 0;
  const totalSteps = 3 + services.length; // basis + odometer + driving style + one per service

  openModal('Set up your plan', null, card => {
    const progress = el('div', 'wiz-progress');
    const bar = el('div', 'wiz-bar', '<span></span>');
    const body = el('div', 'wiz-card');
    const nav = el('div', 'wiz-nav');
    const backBtn = el('button', 'btn ghost', t('Back'));
    const nextBtn = el('button', 'btn primary', t('Next'));
    nav.appendChild(backBtn); nav.appendChild(nextBtn);
    const skipAll = el('button', 'btn block ghost wiz-skip', t('Skip for now'));
    card.appendChild(progress); card.appendChild(bar); card.appendChild(body); card.appendChild(nav); card.appendChild(skipAll);

    function renderStep() {
      progress.textContent = `${t('Step')} ${step + 1} ${t('of')} ${totalSteps}`;
      bar.firstElementChild.style.width = `${(step / (totalSteps - 1)) * 100}%`;
      backBtn.style.visibility = step === 0 ? 'hidden' : '';
      nextBtn.textContent = step === totalSteps - 1 ? t('Finish') : t('Next');
      body.innerHTML = '';

      if (step === 0) {
        body.innerHTML = `
          <div class="item-ic">📍</div>
          <h3>${t('Which schedule fits your car?')}</h3>
          <p>${t('Jeddah heat & dust call for shorter intervals; the dealer sheet is the standard Mazda schedule.')}</p>
          <div class="wiz-choice">
            <button class="wiz-opt ${basis === 'severe' ? 'on' : ''}" data-v="severe">${t('Jeddah (severe)')}</button>
            <button class="wiz-opt ${basis === 'normal' ? 'on' : ''}" data-v="normal">${t('Dealer (normal)')}</button>
          </div>`;
        body.querySelectorAll('.wiz-opt').forEach(btn => btn.onclick = () => {
          basis = btn.dataset.v;
          body.querySelectorAll('.wiz-opt').forEach(b => b.classList.toggle('on', b === btn));
        });
      } else if (step === 1) {
        body.innerHTML = `
          <div class="item-ic">🧭</div>
          <h3>${t('Current odometer')}</h3>
          <p>${t('Keeps every due date and estimate accurate.')}</p>
          <div class="wiz-km"><input id="wiz_odo" type="number" inputmode="numeric" placeholder="${t('e.g. 316,000')}" value="${odo}"></div>`;
        const odoInput = $('#wiz_odo', body);
        odoInput.oninput = () => { odo = odoInput.value; odoInput.classList.remove('err'); };
        setTimeout(() => odoInput.focus(), 30);
      } else if (step === 2) {
        const displayVal = driveUnit === 'day' ? Math.round(dailyKm) : Math.round(dailyKm * 30);
        body.innerHTML = `
          <div class="item-ic">🛣️</div>
          <h3>${t('How much do you drive?')}</h3>
          <p>${t('Used to turn km into calendar dates, and to adjust the plan to your driving style — a rough average is fine.')}</p>
          <div class="wiz-choice">
            <button class="wiz-opt ${driveUnit === 'day' ? 'on' : ''}" data-v="day">${t('Per day')}</button>
            <button class="wiz-opt ${driveUnit === 'month' ? 'on' : ''}" data-v="month">${t('Per month')}</button>
          </div>
          <div class="wiz-km">
            <label>${t('Average km')}</label>
            <input id="wiz_drive" type="number" inputmode="numeric" placeholder="${t('e.g. 40')}" value="${displayVal}">
          </div>`;
        const driveInput = $('#wiz_drive', body);
        driveInput.oninput = () => {
          driveInput.classList.remove('err');
          const val = parseFloat(driveInput.value);
          if (!isNaN(val) && val > 0) dailyKm = driveUnit === 'day' ? val : val / 30;
        };
        body.querySelectorAll('.wiz-opt').forEach(btn => btn.onclick = () => { driveUnit = btn.dataset.v; renderStep(); });
        setTimeout(() => driveInput.focus(), 30);
      } else {
        const a = answers[step - 3];
        const s = a.s;
        body.innerHTML = `
          <div class="item-ic">${s.icon || '🔧'}</div>
          <h3>${t(s.name)}</h3>
          <p>${t('Have you had this done?')}</p>
          <div class="wiz-choice">
            <button class="wiz-opt ${a.choice === 'yes' ? 'on' : ''}" data-v="yes">${t('Yes, done')}</button>
            <button class="wiz-opt ${a.choice === 'skip' ? 'on' : ''}" data-v="skip">${t('Not sure / skip')}</button>
          </div>
          <div class="wiz-km"${a.choice === 'yes' ? '' : ' hidden'}>
            <label>${t('At what km (roughly)?')}</label>
            <input type="number" inputmode="numeric" placeholder="${t('km')}" value="${a.km}">
          </div>`;
        const kmWrap = body.querySelector('.wiz-km');
        const kmInput = kmWrap.querySelector('input');
        kmInput.oninput = () => { a.km = kmInput.value; kmInput.classList.remove('err'); };
        body.querySelectorAll('.wiz-opt').forEach(btn => btn.onclick = () => {
          a.choice = btn.dataset.v;
          body.querySelectorAll('.wiz-opt').forEach(b => b.classList.toggle('on', b === btn));
          kmWrap.hidden = a.choice !== 'yes';
          if (a.choice === 'yes') kmInput.focus();
        });
      }
    }

    function applyGeneralSettings() {
      state.severity = basis;
      const finalOdo = parseInt(odo, 10);
      if (!isNaN(finalOdo) && finalOdo > 0) state.car.odometer = finalOdo;
      if (dailyKm > 0) state.car.dailyKm = dailyKm;
    }

    async function finish() {
      applyGeneralSettings();
      const dpk = state.car.dailyKm || 40;
      answers.forEach(a => {
        if (a.choice !== 'yes') return;
        const val = parseInt(a.km, 10);
        if (isNaN(val) || val <= 0) return;
        a.s.lastKm = val;
        const days = Math.max(0, ((state.car.odometer || val) - val) / dpk);
        a.s.lastDate = isoDate(new Date(today().getTime() - days * 86400000));
      });
      state.planSetupDone = true;
      const ok = await save(); closeModal(); go('maintenance'); if (ok) toast(t('Plan updated'));
    }

    backBtn.onclick = () => { if (step > 0) { step--; renderStep(); } };
    nextBtn.onclick = async () => {
      if (step === 1) {
        const od = parseInt(odo, 10);
        if (isNaN(od) || od <= 0) { $('#wiz_odo', body).classList.add('err'); toast(t('Enter your current odometer'), 'warn'); return; }
      } else if (step === 2) {
        const val = parseFloat($('#wiz_drive', body).value);
        if (isNaN(val) || val <= 0) { $('#wiz_drive', body).classList.add('err'); toast(t('Enter your average driving distance'), 'warn'); return; }
      } else if (step >= 3) {
        const a = answers[step - 3];
        if (a.choice === 'yes') {
          const val = parseInt(a.km, 10);
          if (isNaN(val) || val <= 0) { body.querySelector('.wiz-km input').classList.add('err'); toast(t('Enter a km for this service'), 'warn'); return; }
        }
      }
      if (step === totalSteps - 1) { await finish(); return; }
      step++; renderStep();
    };
    skipAll.onclick = () => {
      applyGeneralSettings(); state.planSetupDone = true;
      save(); // fire-and-forget: nothing downstream reads the result
      closeModal(); go('maintenance');
    };

    renderStep();
  });
}

function buildSchedule(v) {
  const seg = el('div', 'seg');
  const filters = ['Due soon', 'Overdue', 'OK', 'All'];
  let active = (navIntent && filters.includes(navIntent.filter)) ? navIntent.filter : 'All';
  navIntent = null; // consumed
  filters.forEach(f => {
    const b = el('button', f === active ? 'on' : '', t(f));
    b.onclick = () => { active = f; [...seg.children].forEach(c => c.classList.toggle('on', c === b)); paint(); };
    seg.appendChild(b);
  });
  v.appendChild(seg);

  const tl = el('div', 'timeline');
  v.appendChild(tl);

  function paint() {
    tl.innerHTML = '';
    let items = servicesRanked();
    if (active === 'Overdue') items = items.filter(r => r.st.level === 'danger');
    else if (active === 'Due soon') items = items.filter(r => r.st.level === 'warn');
    else if (active === 'OK') items = items.filter(r => r.st.level === 'ok');
    if (!items.length) { tl.appendChild(emptyState('🎉', 'Nothing here — all good!')); return; }

    // chronological — soonest due first, which naturally leads with overdue items (their due date already passed)
    items = items.slice().sort((a, b) => a.st.dueDate - b.st.dueDate);
    let lastYear = null;
    items.forEach(({ s, st }, i) => {
      const yr = st.dueDate.getFullYear();
      if (yr !== lastYear) { tl.appendChild(el('div', 'tl-year', String(yr))); lastYear = yr; }
      tl.appendChild(scheduleTimelineItem(s, st, i === items.length - 1));
    });
  }
  paint();

  const add = el('button', 'btn block ghost', iconSvg('plus') + t('Add a custom service'));
  add.style.marginTop = '16px';
  add.onclick = () => openEditService(null);
  v.appendChild(add);
}

function scheduleTimelineItem(s, st, isLast) {
  const item = el('div', 'tl-item' + (isLast ? ' last' : ''));
  const pillTxt = t(st.level === 'danger' ? 'Overdue' : st.level === 'warn' ? 'Due soon' : 'On track');
  const kmTxt = st.kmLeft <= 0 ? `${fmt(-st.kmLeft)} ${t('km over')}` : `${fmt(st.kmLeft)} ${t('km left')}`;
  item.innerHTML = `
    <div class="tl-dot ${st.level}">${s.icon || '🔧'}</div>
    <div class="card tl-card">
      <div class="tl-top"><h3>${t(s.name)}</h3><span class="pill ${st.level}">${pillTxt}</span></div>
      <div class="tl-sub">${st.dueDate.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })} · ${kmTxt}</div>
    </div>`;
  item.querySelector('.tl-card').onclick = () => openServiceDetail(s);
  return item;
}

function buildHistory(v) {
  const hist = [...state.history].sort((a, b) => b.date.localeCompare(a.date) || b.odometer - a.odometer);
  const totalCost = hist.reduce((a, e) => a + Number(e.cost || 0), 0);
  const last = hist[0];

  const tiles = el('div', 'tiles');
  tiles.innerHTML = `
    <div class="tile"><div class="t-num">${hist.length}</div><div class="t-cap">${t('Services logged')}</div></div>
    <div class="tile"><div class="t-num">${sar(totalCost)}</div><div class="t-cap">${t('SAR total')}</div></div>
    <div class="tile"><div class="t-num" style="font-size:15px;line-height:1.9">${last ? new Date(last.date + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short' }) : '—'}</div><div class="t-cap">${t('Last service')}</div></div>`;
  v.appendChild(tiles);

  const add = el('button', 'btn block primary', iconSvg('plus') + t('Log a past service'));
  add.style.margin = '14px 0 6px';
  add.onclick = () => openAddHistory(null);
  v.appendChild(add);

  if (!hist.length) { v.appendChild(emptyState('🧰', 'No service history yet.\nLog your first one above.')); return; }

  const tl = el('div', 'timeline');
  let lastYear = null;
  hist.forEach((e, i) => {
    const yr = e.date.slice(0, 4);
    if (yr !== lastYear) { tl.appendChild(el('div', 'tl-year', yr)); lastYear = yr; }
    const item = el('div', 'tl-item' + (i === hist.length - 1 ? ' last' : ''));
    const d = new Date(e.date + 'T00:00:00');
    item.innerHTML = `
      <div class="tl-dot">${e.icon || '🔧'}</div>
      <div class="card tl-card">
        <div class="tl-top"><h3>${t(e.name)}${e.photo ? ' 🧾' : ''}</h3><div class="tl-cost">${e.cost > 0 ? sar(e.cost) + ' SAR' : '—'}</div></div>
        <div class="tl-sub">${d.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })} · ${fmt(e.odometer)} km</div>
        ${e.note ? `<div class="tl-note">${e.note}</div>` : ''}
      </div>`;
    item.querySelector('.tl-card').onclick = () => openAddHistory(e);
    tl.appendChild(item);
  });
  v.appendChild(tl);
}

function serviceItem(s, st, withBar) {
  const item = el('div', 'item');
  const pillTxt = t(st.level === 'danger' ? 'Overdue' : st.level === 'warn' ? 'Due soon' : 'On track');
  const kmTxt = st.kmLeft <= 0 ? `${fmt(-st.kmLeft)} ${t('km over')}` : `${fmt(st.kmLeft)} ${t('km left')}`;
  item.innerHTML = `
    <div class="item-ic">${s.icon || '🔧'}</div>
    <div class="item-main">
      <h3>${s.deferred ? '⏰ ' : ''}${t(s.name)}</h3>
      <p>${s.deferred ? t('Skipped — do it') + ' · ' : ''}${st.drivenByTime ? relDate(st.dueDate) + ' · ' : ''}${kmTxt}</p>
      ${withBar ? `<div class="bar ${st.level}"><span style="width:${clamp(st.prog, 0, 1) * 100}%"></span></div>` : ''}
    </div>
    <div class="item-side"><span class="pill ${st.level}">${pillTxt}</span></div>`;
  item.onclick = () => openServiceDetail(s);
  return item;
}

/* ============================================================
   PAGE 3 — PARTS
   ============================================================ */
function renderParts() {
  const v = el('div');
  v.appendChild(pageIntro('Car Parts', 'OEM parts with cheaper alternatives, prices and where to buy. Tap a part to compare.'));

  const cats = ['All', ...new Set(state.parts.map(p => p.cat))];
  let active = 'All';
  const seg = el('div', 'seg');
  seg.style.flexWrap = 'wrap';
  cats.forEach(c => {
    const b = el('button', c === active ? 'on' : '', t(c));
    b.onclick = () => { active = c; [...seg.children].forEach(x => x.classList.toggle('on', x === b)); paint(); };
    seg.appendChild(b);
  });
  v.appendChild(seg);

  const list = el('div', 'list');
  v.appendChild(list);
  function paint() {
    list.innerHTML = '';
    const items = state.parts.filter(p => active === 'All' || p.cat === active);
    items.forEach(p => list.appendChild(partCard(p)));
  }
  paint();

  // arriving via a "View part" link from Maintenance — open & scroll to it
  if (navIntent && navIntent.openPart) {
    const targetId = navIntent.openPart; navIntent = null;
    setTimeout(() => {
      const cardEl = list.querySelector(`[data-id="${targetId}"]`);
      if (cardEl) { cardEl.classList.add('open'); cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }, 60);
  }

  const add = el('button', 'btn block ghost', iconSvg('plus') + t('Add a part'));
  add.style.marginTop = '16px';
  add.onclick = () => openEditPart(null);
  v.appendChild(add);
  return v;
}

function partCard(p) {
  const cheapest = partCheapest(p);
  const usedIn = servicesForPart(p);
  const card = el('div', 'card part');
  card.dataset.id = p.id;
  card.innerHTML = `
    <div class="part-head">
      <div class="item-ic">${p.icon || '🔩'}</div>
      <h3>${t(p.name)}</h3>
      <div style="text-align:right">
        <div style="font-weight:750;font-size:14px">${t('from')} ${sar(cheapest)} <span class="muted" style="font-size:11px">SAR</span></div>
        <div class="muted" style="font-size:11px">${p.options.length} ${t('options')}</div>
      </div>
      <button class="part-toggle"><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>
    </div>
    <div class="part-body">
      ${p.options.map(o => `
        <div class="opt">
          <span class="opt-tag ${o.tag === 'OEM' ? 'oem' : 'alt'}">${o.tag}</span>
          <div class="opt-main">
            <div class="b">${t(o.brand)}</div>
            <div class="s">${[o.partNo, t(o.note)].filter(Boolean).join(' · ') || '&nbsp;'}</div>
          </div>
          <div class="opt-price">
            <div class="p">${sar(o.price)} <span class="muted" style="font-size:10px">SAR</span></div>
            <div class="store">${t(o.store)}</div>
          </div>
        </div>`).join('')}
      ${usedIn.length ? `<div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:6px;align-items:center">
        <span class="muted" style="font-size:11px;font-weight:600">${t('🔧 Used in:')}</span>
        ${usedIn.map(s => `<button class="chip-link" data-svc="${s.id}">${t(s.name)}</button>`).join('')}
      </div>` : ''}
      ${p.partsouq ? `<a class="btn" href="https://partsouq.com/en/search/all?q=${encodeURIComponent(p.partsouq)}" target="_blank" rel="noopener noreferrer" style="width:100%;margin-top:12px;font-size:12.5px;padding:11px;text-decoration:none;color:var(--accent-soft)">${t('🔎 Live price &amp; alternatives on PartSouq ↗')}</a>` : ''}
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn ghost" style="flex:1;font-size:12.5px;padding:9px" data-edit>${t('Edit')}</button>
      </div>
    </div>`;
  const toggle = () => card.classList.toggle('open');
  card.querySelector('.part-head').onclick = e => { if (!e.target.closest('.part-toggle') && !e.target.closest('button')) toggle(); };
  card.querySelector('.part-toggle').onclick = toggle;
  card.querySelector('[data-edit]').onclick = e => { e.stopPropagation(); openEditPart(p); };
  card.querySelectorAll('[data-svc]').forEach(btn => btn.onclick = e => {
    e.stopPropagation();
    const s = state.services.find(x => x.id === btn.dataset.svc);
    if (s) { go('maintenance'); setTimeout(() => openServiceDetail(s), 0); }
  });
  return card;
}

/* ============================================================
   PAGE 4 — BUDGET & SPENDING
   ============================================================ */
function renderBudget() {
  const v = el('div');
  v.appendChild(pageIntro('Budget & Spending', 'Track what your Mazda costs to run and keep it in top shape.'));

  const spent = yearSpend(today().getFullYear());
  const budget = state.budget.annual;
  const pct = clamp(budget ? spent / budget : 0, 0, 1.2);
  const dash = 2 * Math.PI * 40;
  const overBudget = spent > budget;

  const ring = el('div', 'card budget-ring-card');
  ring.innerHTML = `
    <div class="ring" style="width:96px;height:96px">
      <svg viewBox="0 0 92 92" style="width:96px;height:96px">
        <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${overBudget ? '#ff4d5e' : '#d6203c'}"/>
          <stop offset="1" stop-color="${overBudget ? '#ff8a95' : '#ff5c6e'}"/>
        </linearGradient></defs>
        <circle class="track" cx="46" cy="46" r="40" fill="none" stroke-width="8"/>
        <circle class="prog" cx="46" cy="46" r="40" fill="none" stroke-width="8"
          stroke-dasharray="${dash}" stroke-dashoffset="${dash * (1 - clamp(pct, 0, 1))}"/>
      </svg>
      <div class="ring-label"><div class="ring-num" style="font-size:19px">${Math.round(pct * 100)}%</div><div class="ring-cap">${t('of budget')}</div></div>
    </div>
    <div style="flex:1">
      <div class="muted" style="font-size:12px">${t('Spent in 2026')}</div>
      <div style="font-size:26px;font-weight:800;letter-spacing:-.5px">${sar(spent)} <span class="muted" style="font-size:13px;font-weight:600">SAR</span></div>
      <div style="font-size:12.5px;margin-top:4px" class="${overBudget ? '' : 'muted'}">
        ${overBudget ? `⚠️ ${sar(spent - budget)} ${t('over budget')}` : `${sar(budget - spent)} ${t('SAR remaining of')} ${sar(budget)}`}
      </div>
      <button class="odo-edit" id="editBudget" style="margin-top:8px">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
        ${t('Set annual budget')}
      </button>
    </div>`;
  v.appendChild(ring);

  // Upcoming maintenance cost — forecast pulled from the Maintenance schedule
  const upcoming = servicesRanked().filter(r => r.st.level !== 'ok');
  if (upcoming.length) {
    const dueCost = upcoming.reduce((a, r) => a + (r.s.cost || 0), 0);
    const odCount = upcoming.filter(r => r.st.level === 'danger').length;
    const fc = el('div', 'card');
    fc.style.cssText = 'padding:14px 16px;margin-top:12px;display:flex;align-items:center;gap:12px;cursor:pointer';
    fc.innerHTML = `
      <div class="item-ic">🔧</div>
      <div style="flex:1">
        <h3 style="font-size:13.5px;font-weight:650">${t('Upcoming maintenance')}</h3>
        <p class="muted" style="font-size:12px;margin-top:2px">${upcoming.length} ${t('services due')}${odCount ? ` · ${odCount} ${t('overdue')}` : ''} — ${t('plan ~')}${sar(dueCost)} SAR</p>
      </div>
      <span style="color:var(--accent-soft);font-size:12.5px;font-weight:600">${t('View ›')}</span>`;
    fc.onclick = () => go('maintenance', { filter: odCount ? 'Overdue' : 'Due soon' });
    v.appendChild(fc);
  }

  // monthly bars (last 6 months)
  v.appendChild(sectionTitle('Monthly spending', '', null));
  const bars = el('div', 'card');
  bars.style.padding = '16px';
  bars.appendChild(monthlyBars());
  v.appendChild(bars);

  // breakdown by category
  const byCat = {};
  state.spending.filter(e => e.date.startsWith('2026')).forEach(e => { byCat[e.cat] = (byCat[e.cat] || 0) + Number(e.amount); });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  if (cats.length) {
    v.appendChild(sectionTitle('By category (2026)', '', null));
    // (category names translated below)
    const cc = el('div', 'card');
    cc.style.padding = '14px 16px';
    const total = cats.reduce((a, c) => a + c[1], 0) || 1;
    cc.innerHTML = cats.map(([k, val]) => `
      <div style="margin:10px 0 12px">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px">
          <span>${t(k)}</span><span style="font-weight:700">${sar(val)} SAR</span>
        </div>
        <div class="bar"><span style="width:${(val / total) * 100}%"></span></div>
      </div>`).join('');
    v.appendChild(cc);
  }

  // spending log
  v.appendChild(sectionTitle('Recent spending', 'Add', () => openAddSpending()));
  const log = el('div', 'list');
  const sorted = [...state.spending].sort((a, b) => b.date.localeCompare(a.date));
  if (!sorted.length) log.appendChild(emptyState('🧾', 'No spending logged yet.'));
  sorted.slice(0, 12).forEach(e => log.appendChild(spendEntry(e)));
  v.appendChild(log);

  ring.querySelector('#editBudget').onclick = openEditBudget;
  return v;
}

/* ============================================================
   PAGE 5 — REPORTS (printable A4)
   ============================================================ */
let reportType = 'service'; // remembered across renders in the session
function renderReports() {
  const v = el('div', 'rpt-view');
  v.appendChild(pageIntro('Reports', 'Generate a clean, printable A4 report — then Print or Save as PDF.'));

  const toolbar = el('div', 'rpt-toolbar');
  const seg = el('div', 'seg');
  seg.style.flexWrap = 'wrap';
  const types = [['service', 'Service history'], ['purchases', 'Purchases'], ['summary', 'Full summary']];
  types.forEach(([k, label]) => {
    const b = el('button', k === reportType ? 'on' : '', t(label));
    b.onclick = () => { reportType = k; [...seg.children].forEach(x => x.classList.toggle('on', x === b)); paint(); };
    seg.appendChild(b);
  });
  const printBtn = el('button', 'btn primary', `<svg viewBox="0 0 24 24"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z"/></svg>${t('Print / Save PDF')}`);
  printBtn.onclick = () => window.print();
  toolbar.append(seg, printBtn);
  v.appendChild(toolbar);

  const wrap = el('div', 'rpt-paper-wrap');
  const paper = el('div', 'rpt-paper');
  wrap.appendChild(paper);
  v.appendChild(wrap);
  function paint() { paper.innerHTML = reportHTML(reportType); }
  paint();
  return v;
}

function reportHTML(type) {
  return type === 'purchases' ? reportPurchases() : type === 'summary' ? reportSummary() : reportService();
}
function reportHeader(title) {
  const c = state.car;
  const name = c.nickname || [c.year, c.make, c.model].filter(Boolean).join(' ') || 'Vehicle';
  const initials = ((c.make ? c.make[0] : 'M') + (c.model ? c.model[0] : '3')).toUpperCase();
  return `
    <div class="rpt-head">
      <div class="rpt-brand">
        <div class="rpt-badge">${initials}</div>
        <div><h2>${name}</h2><p>${[c.engine, c.transmission, c.color].filter(Boolean).join(' · ')}</p></div>
      </div>
      <div class="rpt-meta">
        <div class="rpt-title">${title}</div>
        <div>${t('Generated')} ${today().toLocaleDateString('en', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
        <div>${t('Odometer ')}${fmt(c.odometer)} km${c.plate ? ` · ${c.plate}` : ''}</div>
        ${c.vin ? `<div>VIN ${c.vin}</div>` : ''}
      </div>
    </div>`;
}
function reportFooter() {
  return `<div class="rpt-foot"><span>${t('Garage · Mazda 3 care app')}</span><span>${t('Report generated')} ${today().toLocaleDateString('en', { day: '2-digit', month: 'short', year: 'numeric' })}</span></div>`;
}
function reportService() {
  const hist = [...state.history].sort((a, b) => b.date.localeCompare(a.date) || b.odometer - a.odometer);
  const total = hist.reduce((a, e) => a + Number(e.cost || 0), 0);
  const body = !hist.length
    ? `<div class="rpt-empty">${t('No service history recorded yet.')}</div>`
    : `<div class="rpt-cards">
        <div class="rpt-stat"><div class="n">${hist.length}</div><div class="l">${t('Services logged')}</div></div>
        <div class="rpt-stat"><div class="n">${sar(total)}</div><div class="l">${t('Total spent (SAR)')}</div></div>
        <div class="rpt-stat"><div class="n">${fmt(state.car.odometer)}</div><div class="l">${t('Current odometer (km)')}</div></div>
      </div>
      <div class="rpt-section-title">${t('Work history')}</div>
      <table class="rpt-table">
        <thead><tr><th>${t('Date')}</th><th>${t('Service')}</th><th>${t('Category')}</th><th class="num">${t('Odometer')}</th><th class="num">${t('Cost')}</th><th>${t('Notes')}</th></tr></thead>
        <tbody>${hist.map(e => `<tr>
          <td>${new Date(e.date + 'T00:00:00').toLocaleDateString('en', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
          <td>${t(e.name)}</td><td>${e.cat ? t(e.cat) : '—'}</td>
          <td class="num">${fmt(e.odometer)} km</td>
          <td class="num">${e.cost > 0 ? sar(e.cost) + ' SAR' : '—'}</td>
          <td>${e.note || ''}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="4">${t('Total')}</td><td class="num">${sar(total)} SAR</td><td></td></tr></tfoot>
      </table>`;
  return reportHeader(t('Service History Report')) + body + reportFooter();
}
function reportPurchases() {
  const sp = [...state.spending].sort((a, b) => b.date.localeCompare(a.date));
  const total = sp.reduce((a, e) => a + Number(e.amount || 0), 0);
  const byCat = {};
  sp.forEach(e => { byCat[e.cat] = (byCat[e.cat] || 0) + Number(e.amount || 0); });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const body = !sp.length
    ? `<div class="rpt-empty">${t('No purchases or spending recorded yet.')}</div>`
    : `<div class="rpt-cards">
        <div class="rpt-stat"><div class="n">${sp.length}</div><div class="l">${t('Entries')}</div></div>
        <div class="rpt-stat"><div class="n">${sar(total)}</div><div class="l">${t('Total spent (SAR)')}</div></div>
        <div class="rpt-stat"><div class="n">${cats.length}</div><div class="l">${t('Categories')}</div></div>
      </div>
      <div class="rpt-section-title">${t('By category')}</div>
      <table class="rpt-table"><thead><tr><th>${t('Category')}</th><th class="num">${t('Amount')}</th><th class="num">${t('Share')}</th></tr></thead>
        <tbody>${cats.map(([k, val]) => `<tr><td>${t(k)}</td><td class="num">${sar(val)} SAR</td><td class="num">${Math.round(val / (total || 1) * 100)}%</td></tr>`).join('')}</tbody></table>
      <div class="rpt-section-title">${t('All purchases')}</div>
      <table class="rpt-table">
        <thead><tr><th>${t('Date')}</th><th>${t('Item')}</th><th>${t('Category')}</th><th class="num">${t('Odometer')}</th><th class="num">${t('Amount')}</th></tr></thead>
        <tbody>${sp.map(e => `<tr>
          <td>${new Date(e.date + 'T00:00:00').toLocaleDateString('en', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
          <td>${e.desc}</td><td>${t(e.cat)}</td>
          <td class="num">${e.odometer ? fmt(e.odometer) + ' km' : '—'}</td>
          <td class="num">${sar(e.amount)} SAR</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="4">${t('Total')}</td><td class="num">${sar(total)} SAR</td></tr></tfoot>
      </table>`;
  return reportHeader(t('Purchases & Spending Report')) + body + reportFooter();
}
function reportSummary() {
  const ranked = servicesRanked();
  const overdue = ranked.filter(r => r.st.level === 'danger');
  const soon = ranked.filter(r => r.st.level === 'warn');
  const due = [...overdue, ...soon];
  const dueCost = due.reduce((a, r) => a + (r.s.cost || 0), 0);
  const hs = healthScore();
  const spent = yearSpend(today().getFullYear());
  const histTotal = state.history.reduce((a, e) => a + Number(e.cost || 0), 0);
  const dueRows = due.length
    ? due.map(({ s, st }) => `<tr><td>${t(s.name)}</td><td>${st.level === 'danger' ? t('Overdue') : t('Due soon')}</td><td class="num">${st.kmLeft <= 0 ? fmt(-st.kmLeft) + ' ' + t('km over') : fmt(st.kmLeft) + ' ' + t('km left')}</td><td class="num">${sar(s.cost)} SAR</td></tr>`).join('')
    : `<tr><td colspan="4" style="text-align:center;color:#8b93a3;padding:16px">${t('Everything is up to date 🎉')}</td></tr>`;
  return reportHeader(t('Vehicle Summary Report')) + `
    <div class="rpt-cards">
      <div class="rpt-stat"><div class="n">${hs}</div><div class="l">${t('Health score')}</div></div>
      <div class="rpt-stat"><div class="n">${soon.length}</div><div class="l">${t('Due soon')}</div></div>
      <div class="rpt-stat"><div class="n">${overdue.length}</div><div class="l">${t('Overdue')}</div></div>
    </div>
    <div class="rpt-cards" style="margin-top:12px">
      <div class="rpt-stat"><div class="n">${sar(spent)}</div><div class="l">${t('Spent in 2026 (SAR)')}</div></div>
      <div class="rpt-stat"><div class="n">${sar(histTotal)}</div><div class="l">${t('Lifetime service cost')}</div></div>
      <div class="rpt-stat"><div class="n">${state.history.length}</div><div class="l">${t('Services logged')}</div></div>
    </div>
    <div class="rpt-section-title">${t('Upcoming &amp; overdue services')}</div>
    <table class="rpt-table">
      <thead><tr><th>${t('Service')}</th><th>${t('Status')}</th><th class="num">${t('Distance')}</th><th class="num">${t('Est. cost')}</th></tr></thead>
      <tbody>${dueRows}</tbody>
      ${due.length ? `<tfoot><tr><td colspan="3">${t('Estimated total')}</td><td class="num">${sar(dueCost)} SAR</td></tr></tfoot>` : ''}
    </table>` + reportFooter();
}

function monthlyBars() {
  const wrap = el('div', 'spend-bars');
  const months = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(today().getFullYear(), today().getMonth() - i, 1); months.push(d); }
  const totals = months.map(m => {
    const key = m.getFullYear() + '-' + String(m.getMonth() + 1).padStart(2, '0'); // local month, no TZ shift
    return state.spending.filter(e => e.date.startsWith(key)).reduce((a, e) => a + Number(e.amount), 0);
  });
  const max = Math.max(1, ...totals);
  months.forEach((m, i) => {
    const isNow = i === months.length - 1;
    const sb = el('div', 'sb' + (isNow ? ' now' : ''));
    const h = Math.max(4, (totals[i] / max) * 100);
    sb.innerHTML = `<div class="col" style="height:${h}%"></div><div class="m">${m.toLocaleString('en', { month: 'short' })}</div>`;
    sb.title = `${sar(totals[i])} SAR`;
    wrap.appendChild(sb);
  });
  return wrap;
}

function spendEntry(e) {
  const emoji = { Maintenance: '🔧', Tires: '🛞', Parts: '📦', Fuel: '⛽', Electrical: '🔋', Insurance: '📄', Other: '💠' }[e.cat] || '💠';
  const it = el('div', 'card entry');
  it.innerHTML = `
    <div class="e-ic">${emoji}</div>
    <div class="e-main"><h3>${e.desc}${e.photo ? ' 🧾' : ''}</h3><p>${t(e.cat)} · ${new Date(e.date + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })}</p></div>
    <div class="e-amt">${sar(e.amount)} <span class="muted" style="font-size:10px">SAR</span></div>`;
  it.onclick = () => openAddSpending(e);
  return it;
}

/* ---------- recommendations (Dashboard only) ---------- */
function recommendations() {
  const out = [];

  // evergreen tips — from the 5-year Jeddah maintenance plan (Usage & Climate Notes)
  const tips = [
    ['🛢️', 'Oil every ~7,500 km', "In Jeddah's heat, shorten oil changes to ~7,500 km if you mostly do city driving. Fresh 5W-30 (API SP) keeps the SkyActiv engine clean."],
    ['🛞', 'Tire pressure 36 PSI', 'Keep tires at 36 PSI and check monthly (when cold). Correct pressure saves fuel and prevents blowouts on hot asphalt.'],
    ['🔋', 'Battery every 2–3 years', 'Heat-related wear shortens battery life in Jeddah — plan to replace it every 2–3 years, and load-test it yearly.'],
    ['💧', 'Wash the underbody', "Wash the underbody occasionally to protect against corrosion from Jeddah's coastal salt air."]
  ];
  tips.forEach(tip => out.push(recCard(tip[0], t(tip[1]), t(tip[2]))));
  return out;
}
function recCard(ic, title, body) {
  const c = el('div', 'card rec');
  c.innerHTML = `<div class="r-ic">${ic}</div><div><h3>${title}</h3><p>${body}</p></div>`;
  return c;
}

/* ============================================================
   MODALS
   ============================================================ */
/* ============================================================
   PAGE 6 — FUEL LOG & ECONOMY
   ============================================================ */
function fuelRows() {
  const entries = [...(state.fuel || [])].sort((a, b) => a.date.localeCompare(b.date) || a.odometer - b.odometer);
  return entries.map((e, i) => {
    const prev = entries[i - 1];
    let l100 = null, km = null, costPerKm = null;
    if (prev && e.odometer > prev.odometer && e.litres > 0) {
      km = e.odometer - prev.odometer;
      l100 = e.litres / km * 100;
      costPerKm = (Number(e.cost) || 0) / km;
    }
    return { e, l100, km, costPerKm };
  });
}
function renderFuel() {
  if (!state.fuel) state.fuel = [];
  const v = el('div');
  v.appendChild(pageIntro('Fuel', 'Log fill-ups to track economy (L/100 km) and running cost.'));

  const rows = fuelRows();
  const withEcon = rows.filter(r => r.l100 != null);
  const avg = withEcon.length ? withEcon.reduce((a, r) => a + r.l100, 0) / withEcon.length : null;
  const last = withEcon.length ? withEcon[withEcon.length - 1].l100 : null;
  const lastCPK = withEcon.length ? withEcon[withEcon.length - 1].costPerKm : null;
  const totalFuel = (state.fuel).reduce((a, e) => a + (Number(e.cost) || 0), 0);

  const tiles = el('div', 'tiles');
  tiles.innerHTML = `
    <div class="tile"><div class="t-num">${last != null ? last.toFixed(1) : '—'}</div><div class="t-cap">${t('Last L/100km')}</div></div>
    <div class="tile"><div class="t-num">${avg != null ? avg.toFixed(1) : '—'}</div><div class="t-cap">${t('Avg L/100km')}</div></div>
    <div class="tile"><div class="t-num">${lastCPK != null ? lastCPK.toFixed(2) : '—'}</div><div class="t-cap">${t('SAR / km')}</div></div>`;
  v.appendChild(tiles);

  // economy-drop early warning → points to culprits already in the app
  if (last != null && avg != null && last > avg * 1.15) {
    const warn = el('div', 'card rec');
    warn.style.borderLeftColor = 'var(--warn)';
    warn.innerHTML = `<div class="r-ic">⚠️</div><div><h3>${t('Fuel economy has dropped')}</h3><p>${t('Last fill-up was')} ${last.toFixed(1)} L/100km ${t('vs your')} ${avg.toFixed(1)} ${t('average.')} ${t('Common causes: low tire pressure (keep 36 PSI), dirty air filter, worn MAF/O2 sensor, tired spark plugs, or a dragging brake.')}</p></div>`;
    v.appendChild(warn);
  }

  const add = el('button', 'btn primary block', iconSvg('plus') + t('Add fill-up'));
  add.style.margin = '14px 0 4px';
  add.onclick = () => openAddFuel(null);
  v.appendChild(add);

  if (withEcon.length) {
    v.appendChild(sectionTitle('Economy trend — L/100km (lower is better)', '', null));
    const card = el('div', 'card');
    card.style.padding = '16px';
    card.appendChild(fuelBars(withEcon.slice(-8)));
    v.appendChild(card);
  }

  v.appendChild(sectionTitle('Fill-up log', '', null));
  const list = el('div', 'list');
  if (!rows.length) list.appendChild(emptyState('⛽', 'No fill-ups logged yet.\nTap "Add fill-up" after your next refuel.'));
  [...rows].reverse().forEach(({ e, l100, km }) => {
    const it = el('div', 'card entry');
    it.innerHTML = `
      <div class="e-ic">⛽</div>
      <div class="e-main">
        <h3>${e.litres} L${e.full === false ? ' · ' + t('partial') : ''}${l100 != null ? ` · ${l100.toFixed(1)} L/100km` : ''}</h3>
        <p>${new Date(e.date + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })} · ${fmt(e.odometer)} km${km ? ` · +${fmt(km)} km` : ''}</p>
      </div>
      <div class="e-amt">${sar(e.cost)} <span class="muted" style="font-size:10px">SAR</span></div>`;
    it.onclick = () => openAddFuel(e);
    list.appendChild(it);
  });
  v.appendChild(list);
  return v;
}
function fuelBars(points) {
  const wrap = el('div', 'spend-bars');
  const max = Math.max(...points.map(p => p.l100), 1);
  points.forEach((p, i) => {
    const isNow = i === points.length - 1;
    const sb = el('div', 'sb' + (isNow ? ' now' : ''));
    const h = Math.max(6, p.l100 / max * 100);
    sb.innerHTML = `<div class="col" style="height:${h}%"></div><div class="m">${p.l100.toFixed(1)}</div>`;
    sb.title = p.l100.toFixed(1) + ' L/100km';
    wrap.appendChild(sb);
  });
  return wrap;
}
function openAddFuel(e) {
  const editing = !!e;
  openModal(editing ? 'Edit fill-up' : 'Add fill-up', 'Record a refuel to track economy & cost.', card => {
    const r0 = el('div', 'field-row');
    r0.append(field('Date', `<input id="f_date" type="date" value="${e ? e.date : isoDate(today())}">`),
      field('Odometer (km)', `<input id="f_odo" type="number" inputmode="numeric" value="${e ? e.odometer : state.car.odometer}">`));
    card.appendChild(r0);
    const r1 = el('div', 'field-row');
    r1.append(field('Litres', `<input id="f_l" type="number" inputmode="decimal" step="0.01" value="${e ? e.litres : ''}" placeholder="${t('e.g. 42')}">`),
      field('Cost (SAR)', `<input id="f_cost" type="number" inputmode="decimal" value="${e ? e.cost : ''}" placeholder="${t('e.g. 95')}">`));
    card.appendChild(r1);
    card.appendChild(field('Tank', `<select id="f_full"><option value="yes"${!e || e.full !== false ? ' selected' : ''}>${t('Full tank')}</option><option value="no"${e && e.full === false ? ' selected' : ''}>${t('Partial fill')}</option></select>`));
    const b = el('button', 'btn primary block', t('Save'));
    b.onclick = async () => {
      const litres = +$('#f_l').value, odo = +$('#f_odo').value;
      if (!litres) return toast('Litres required', 'warn');
      if (!odo) return toast('Odometer required', 'warn');
      const obj = { id: e ? e.id : uid(), date: $('#f_date').value || isoDate(today()), odometer: odo, litres, cost: +$('#f_cost').value || 0, full: $('#f_full').value !== 'no' };
      if (e) Object.assign(e, obj); else { state.fuel = state.fuel || []; state.fuel.push(obj); }
      // a fill-up is a real odometer reading — stamp it with the fill-up's own date
      if (odo > state.car.odometer) { state.car.odometer = odo; state.car.odoUpdatedAt = obj.date; }
      const ok = await save(); closeModal(); go('fuel'); if (ok) toast(editing ? 'Fill-up updated' : 'Fill-up added');
    };
    card.appendChild(b);
    if (editing) {
      const del = el('button', 'btn block ghost', t('Delete fill-up'));
      del.style.cssText = 'margin-top:8px;color:var(--danger)';
      del.onclick = async () => { state.fuel = state.fuel.filter(x => x.id !== e.id); const ok = await save(); closeModal(); go('fuel'); if (ok) toast('Fill-up deleted'); };
      card.appendChild(del);
    }
  });
}

/* ---------- documents & renewals ---------- */
const DOC_ICONS = { 'Insurance': '📄', 'Registration (Istimara)': '🪪', 'Vehicle Inspection (Fahes)': '✅', 'Driving License': '🚗', 'Warranty': '🛡️', 'Other': '📎' };
function docStatus(expiry) {
  if (!expiry) return { level: 'ok', txt: t('No date set') };
  const days = Math.round((parseDate(expiry) - today()) / 86400000);
  const ar = lang === 'ar';
  const level = days < 0 ? 'danger' : days <= 30 ? 'warn' : 'ok';
  const txt = days < 0 ? (ar ? `منتهية منذ ${Math.abs(days)} يوم` : `Expired ${Math.abs(days)}d ago`)
    : days === 0 ? t('Due today')
    : days <= 60 ? (ar ? `خلال ${days} يوم` : `in ${days}d`)
    : (ar ? `خلال ${Math.round(days / 30)} شهر` : `in ${Math.round(days / 30)} mo`);
  return { days, level, txt };
}
function docItem(d) {
  const st = docStatus(d.expiry);
  const it = el('div', 'item');
  it.innerHTML = `
    <div class="item-ic">${DOC_ICONS[d.type] || '📄'}</div>
    <div class="item-main">
      <h3>${d.name ? d.name : t(d.type)}</h3>
      <p>${d.expiry ? t('Expires') + ' ' + new Date(d.expiry + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' }) : t('No expiry date')}${d.number ? ` · ${d.number}` : ''}</p>
    </div>
    <div class="item-side"><span class="pill ${st.level}">${st.txt}</span></div>`;
  it.onclick = () => openAddDoc(d);
  return it;
}
function openAddDoc(d) {
  const editing = !!d;
  const types = Object.keys(DOC_ICONS);
  openModal(editing ? 'Edit document' : 'Add document', 'Track renewals so you never miss an expiry.', card => {
    card.appendChild(field('Type', `<select id="d_type">${types.map(ty => `<option value="${ty}" ${d && d.type === ty ? 'selected' : ''}>${t(ty)}</option>`).join('')}</select>`));
    card.appendChild(field('Label (optional)', `<input id="d_name" value="${d ? (d.name || '') : ''}" placeholder="${t('e.g. Tawuniya comprehensive')}">`));
    const r = el('div', 'field-row');
    r.append(field('Expiry date', `<input id="d_exp" type="date" value="${d ? (d.expiry || '') : ''}">`),
      field('Reference no. (optional)', `<input id="d_num" value="${d ? (d.number || '') : ''}">`));
    card.appendChild(r);
    const b = el('button', 'btn primary block', t('Save'));
    b.onclick = async () => {
      const obj = { id: d ? d.id : uid(), type: $('#d_type').value, name: $('#d_name').value.trim(), expiry: $('#d_exp').value, number: $('#d_num').value.trim() };
      if (d) Object.assign(d, obj); else { state.docs = state.docs || []; state.docs.push(obj); }
      const ok = await save(); closeModal(); go('dashboard'); if (ok) toast(editing ? 'Document updated' : 'Document added');
    };
    card.appendChild(b);
    if (editing) {
      const del = el('button', 'btn block ghost', t('Delete document'));
      del.style.cssText = 'margin-top:8px;color:var(--danger)';
      del.onclick = async () => { state.docs = state.docs.filter(x => x.id !== d.id); const ok = await save(); closeModal(); go('dashboard'); if (ok) toast('Document deleted'); };
      card.appendChild(del);
    }
  });
}

function openModal(title, sub, bodyBuilder) {
  const host = $('#modalHost'), card = $('#modalCard');
  card.innerHTML = '<div class="modal-grip"></div>';
  const h = el('h2', null, t(title)); card.appendChild(h);
  if (sub) card.appendChild(el('p', 'sub', t(sub)));
  bodyBuilder(card);
  host.hidden = false;
  host.querySelector('[data-close]').onclick = closeModal;
}
function closeModal() { $('#modalHost').hidden = true; }
function field(label, inputHtml) {
  const f = el('div', 'field');
  f.innerHTML = `<label>${t(label)}</label>${inputHtml}`;
  return f;
}

function openEditOdo() {
  openModal('Update mileage', 'Keep this current so due dates stay accurate.', card => {
    card.appendChild(field('Odometer (km)', `<input id="m_odo" type="number" inputmode="numeric" value="${state.car.odometer}">`));
    card.appendChild(field('Average driving (km / day)', `<input id="m_daily" type="number" inputmode="numeric" value="${state.car.dailyKm}">`));
    const b = el('button', 'btn primary block', t('Save'));
    b.onclick = async () => {
      const val = parseInt($('#m_odo').value, 10);
      if (!isNaN(val)) { state.car.odometer = val; state.car.odoUpdatedAt = isoDate(today()); }
      const d = parseInt($('#m_daily').value, 10);
      if (!isNaN(d) && d > 0) state.car.dailyKm = d;
      const ok = await save(); closeModal(); go(current); if (ok) toast('Mileage updated');
    };
    card.appendChild(b);
  });
}

/* ---------- car profile / settings ---------- */
function carTitle() { return state.car.nickname || `${state.car.make} ${state.car.model}`.trim() || 'My car'; }
function carInitials() {
  const c = state.car;
  const a = (c.make || '')[0] || '';
  const b = (c.model || '')[0] || '';
  return (a + b).toUpperCase() || '🚗';
}
function renderTopbar() {
  const c = state.car;
  $('#carTitle').textContent = carTitle();
  $('#carSub').textContent = [c.year, c.engine, c.transmission, c.color].filter(Boolean).join(' · ');
  const badge = $('#carBadge');
  if (c.photo) { badge.classList.add('has-photo'); badge.innerHTML = `<img src="${c.photo}" alt="">`; }
  else { badge.classList.remove('has-photo'); badge.textContent = carInitials(); }
}

// downscale an uploaded image to keep localStorage small; returns a JPEG data URL
function readImageResized(file, cb) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const max = 900;
      let { width: w, height: h } = img;
      if (w > max || h > max) { const r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r); }
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      cb(cv.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => toast('Could not read that image', 'warn');
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

/* reusable receipt/photo attachment field (resizes, tap thumbnail to enlarge) */
function photoPicker(current, onChange, label) {
  let photo = current || '';
  const wrap = el('div', 'photo-picker');
  wrap.style.marginBottom = '14px';
  wrap.innerHTML = `
    <div class="photo-preview" data-prev style="cursor:${photo ? 'zoom-in' : 'default'}">${photo ? `<img src="${photo}">` : '🧾'}</div>
    <div class="photo-actions">
      <button class="btn" type="button" data-pick>${photo ? t('Change receipt') : (label || t('Add receipt photo'))}</button>
      <button class="btn ghost" type="button" data-rm ${photo ? '' : 'hidden'} style="color:var(--danger)">${t('Remove')}</button>
      <input type="file" accept="image/*" data-file hidden>
    </div>`;
  const prev = wrap.querySelector('[data-prev]'), pick = wrap.querySelector('[data-pick]'), rm = wrap.querySelector('[data-rm]'), file = wrap.querySelector('[data-file]');
  pick.onclick = () => file.click();
  prev.onclick = () => { if (photo) openImage(photo); };
  file.onchange = ev => { const f = ev.target.files[0]; if (!f) return; readImageResized(f, url => { photo = url; prev.innerHTML = `<img src="${url}">`; prev.style.cursor = 'zoom-in'; pick.textContent = t('Change receipt'); rm.hidden = false; onChange(photo); }); };
  rm.onclick = () => { photo = ''; prev.innerHTML = '🧾'; prev.style.cursor = 'default'; pick.textContent = label || t('Add receipt photo'); rm.hidden = true; onChange(photo); };
  return wrap;
}
function openImage(url) {
  const host = el('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.85);display:grid;place-items:center;padding:20px;cursor:zoom-out';
  host.innerHTML = `<img src="${url}" style="max-width:100%;max-height:100%;border-radius:12px;box-shadow:0 20px 60px -20px rgba(0,0,0,.8)">`;
  host.onclick = () => host.remove();
  document.body.appendChild(host);
}

function openGarage() {
  if (!booted) return;
  openModal('Your garage', 'Switch between your vehicles or add another.', card => {
    const list = el('div', 'list');
    garage.vehicles.forEach(v => {
      const c = v.data.car;
      const active = v.id === garage.activeId;
      const it = el('div', 'item');
      it.innerHTML = `
        <div class="item-ic" style="overflow:hidden">${c.photo ? `<img src="${c.photo}" style="width:100%;height:100%;object-fit:cover">` : '🚗'}</div>
        <div class="item-main"><h3>${vehicleName(c)}</h3><p>${[c.engine, c.color].filter(Boolean).join(' · ')} · ${fmt(c.odometer)} km</p></div>
        <div class="item-side">${active ? `<span class="pill ok">${t('Active')}</span>` : `<span style="color:var(--accent-soft);font-size:12px;font-weight:600">${t('Switch ›')}</span>`}</div>`;
      it.onclick = () => { if (active) { closeModal(); openSettings(); } else switchVehicle(v.id); };
      list.appendChild(it);
    });
    card.appendChild(list);
    const add = el('button', 'btn primary block', iconSvg('plus') + t('Add a vehicle'));
    add.style.marginTop = '14px';
    add.onclick = () => addVehicle();
    card.appendChild(add);
  });
}

function openSettings() {
  if (!booted) return;
  openModal('Car profile', 'These details personalise the app and its badge.', card => {
    const c = state.car;
    // language switch
    card.appendChild(field('Language / اللغة', ''));
    let selectedLang = lang;
    const langSeg = el('div', 'seg');
    langSeg.style.margin = '0 0 16px';
    [['en', 'English'], ['ar', 'العربية']].forEach(([code, label]) => {
      const b = el('button', lang === code ? 'on' : '', label);
      b.onclick = () => { selectedLang = code; [...langSeg.children].forEach(x => x.classList.toggle('on', x === b)); };
      langSeg.appendChild(b);
    });
    card.appendChild(langSeg);

    // plan setup wizard — schedule basis, odometer & service history
    const planRow = el('div', 'card plan-setup-banner');
    planRow.style.margin = '0 0 16px';
    planRow.innerHTML = state.planSetupDone
      ? `<div class="r-ic">🧭</div><div style="flex:1"><h3>${t('Update your plan')}</h3><p class="muted" style="font-size:12px;margin-top:2px">${t('Re-answer the setup questions if anything’s changed.')}</p></div>`
      : `<div class="r-ic">🧭</div><div style="flex:1"><h3>${t('Set up your plan')}</h3><p class="muted" style="font-size:12px;margin-top:2px">${t('Tell the plan which major services you’ve already done.')}</p></div>`;
    const planBtn = el('button', state.planSetupDone ? 'btn ghost' : 'btn', t(state.planSetupDone ? 'Edit' : 'Set up'));
    planBtn.onclick = () => { closeModal(); openPlanSetup(); };
    planRow.appendChild(planBtn);
    card.appendChild(planRow);

    let photo = c.photo || '';

    const picker = el('div', 'photo-picker');
    picker.innerHTML = `
      <div class="photo-preview" id="s_prev">${photo ? `<img src="${photo}">` : '🚗'}</div>
      <div class="photo-actions">
        <button class="btn" id="s_pick">${photo ? t('Change photo') : t('Add photo')}</button>
        <button class="btn ghost" id="s_rm" ${photo ? '' : 'hidden'} style="color:var(--danger)">${t('Remove')}</button>
        <input type="file" accept="image/*" id="s_file" hidden>
      </div>`;
    card.appendChild(picker);
    const prev = picker.querySelector('#s_prev');
    picker.querySelector('#s_pick').onclick = () => picker.querySelector('#s_file').click();
    picker.querySelector('#s_file').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      readImageResized(f, url => { photo = url; prev.innerHTML = `<img src="${url}">`; picker.querySelector('#s_pick').textContent = t('Change photo'); picker.querySelector('#s_rm').hidden = false; });
    };
    picker.querySelector('#s_rm').onclick = () => { photo = ''; prev.innerHTML = '🚗'; picker.querySelector('#s_pick').textContent = t('Add photo'); picker.querySelector('#s_rm').hidden = true; };

    card.appendChild(field('Nickname (optional)', `<input id="c_nick" value="${c.nickname || ''}" placeholder="${t('e.g. The Gray Ghost')}">`));
    const r1 = el('div', 'field-row');
    r1.append(field('Make', `<input id="c_make" value="${c.make || ''}">`), field('Model', `<input id="c_model" value="${c.model || ''}">`));
    card.appendChild(r1);
    const MAZDA3_COLORS = [
      'Soul Red Metallic (Code 41V)',
      'Snowflake White Pearl Mica (Code 25D)',
      'Jet Black Mica (Code 41W)',
      'Deep Crystal Blue Mica (Code 42M)',
      'Blue Reflex Mica (Code 42B)',
      'Meteor Gray Mica (Code 42A)',
      'Liquid Silver Metallic (Code 38P)',
      'Titanium Flash Mica (Code 42S)'
    ];
    const normColor = s => (s || '').toLowerCase().replace(/\s*\(code.*\)/, '').trim();
    let colorOpts = MAZDA3_COLORS.slice();
    let colorSel = MAZDA3_COLORS.find(x => normColor(x) === normColor(c.color));
    if (c.color && !colorSel) { colorOpts = [c.color, ...MAZDA3_COLORS]; colorSel = c.color; }
    const r2 = el('div', 'field-row');
    r2.append(field('Year', `<input id="c_year" type="number" value="${c.year || ''}">`),
      field('Transmission', `<select id="c_trans">${['Automatic', 'Manual'].map(tr => `<option value="${tr}" ${c.transmission === tr ? 'selected' : ''}>${t(tr)}</option>`).join('')}</select>`));
    card.appendChild(r2);

    // Colour — custom dropdown with a colour sample beside each name (full width)
    const colorField = field('Color', `
      <div class="color-picker" id="c_colorPick">
        <input type="hidden" id="c_color" value="${colorSel || ''}">
        <button type="button" class="color-trigger">
          <span class="sw" style="background:${swatchFor(colorSel)}"></span>
          <span class="ct-name">${colorSel || t('Select colour')}</span>
          <svg class="ct-chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <div class="color-menu" hidden>
          ${colorOpts.map(x => `<button type="button" class="color-opt${x === colorSel ? ' sel' : ''}" data-val="${x}"><span class="sw" style="background:${swatchFor(x)}"></span><span>${x}</span></button>`).join('')}
        </div>
      </div>`);
    card.appendChild(colorField);
    (() => {
      const pick = colorField.querySelector('#c_colorPick');
      const trigger = pick.querySelector('.color-trigger');
      const menu = pick.querySelector('.color-menu');
      const hidden = pick.querySelector('#c_color');
      trigger.onclick = () => { const open = pick.classList.toggle('open'); menu.hidden = !open; };
      pick.querySelectorAll('.color-opt').forEach(opt => opt.onclick = () => {
        const val = opt.dataset.val;
        hidden.value = val;
        trigger.querySelector('.ct-name').textContent = val;
        trigger.querySelector('.sw').style.background = swatchFor(val);
        pick.querySelectorAll('.color-opt').forEach(o => o.classList.toggle('sel', o === opt));
        pick.classList.remove('open'); menu.hidden = true;
      });
    })();

    const ENGINES = ['1.6L SkyActiv-G', '2.0L SkyActiv-G'];
    let engOpts = ENGINES.slice();
    let engSel = ENGINES.find(e => c.engine && ((c.engine.includes('1.6') && e.includes('1.6')) || (c.engine.includes('2.0') && e.includes('2.0'))));
    if (c.engine && !engSel) { engOpts = [c.engine, ...ENGINES]; engSel = c.engine; }
    card.appendChild(field('Engine', `<select id="c_engine">${engOpts.map(e => `<option ${e === engSel ? 'selected' : ''}>${e}</option>`).join('')}</select>`));
    const r4 = el('div', 'field-row');
    r4.append(field('Plate number', `<input id="c_plate" value="${c.plate || ''}" placeholder="${t('e.g. ABC 1234')}">`),
      field('VIN', `<input id="c_vin" value="${c.vin || ''}" placeholder="${t('17-char VIN')}">`));
    card.appendChild(r4);

    const b = el('button', 'btn primary block', t('Save profile'));
    b.onclick = async () => {
      Object.assign(state.car, {
        nickname: $('#c_nick').value.trim(), make: $('#c_make').value.trim(), model: $('#c_model').value.trim(),
        year: +$('#c_year').value || c.year, color: $('#c_color').value.trim(),
        engine: $('#c_engine').value.trim(), transmission: $('#c_trans').value,
        plate: $('#c_plate').value.trim(), vin: $('#c_vin').value.trim().toUpperCase(), photo
      });
      let ok = false;
      try { ok = await save(); } catch (e) {}
      // photo may exceed quota — verify it stuck
      if (selectedLang !== lang) applyLang(selectedLang);
      applyAccent(); renderTopbar(); closeModal(); go(current); if (ok) toast('Profile saved');
    };
    card.appendChild(b);
    if (garage.vehicles.length > 1) {
      const del = el('button', 'btn block ghost', t('Remove this vehicle'));
      del.style.cssText = 'margin-top:8px;color:var(--danger)';
      del.onclick = () => deleteVehicle(garage.activeId);
      card.appendChild(del);
    }
    const backup = el('div');
    backup.style.cssText = 'margin-top:22px;padding-top:16px;border-top:1px solid var(--stroke)';
    backup.innerHTML = `<div class="section-title"><div class="section-title-left"><h2>${t('Backup & restore')}</h2></div></div>
      <p style="font-size:12px;color:var(--text-2);line-height:1.55;margin-bottom:12px">${t('A backup file holds every vehicle, service, receipt and photo.')}</p>`;
    const exp = el('button', 'btn block', t('Export backup'));
    exp.onclick = exportGarage;
    const imp = el('button', 'btn block ghost', t('Import backup'));
    imp.style.marginTop = '8px';
    const impFile = el('input');
    impFile.type = 'file';
    impFile.accept = 'application/json';
    impFile.hidden = true;
    impFile.onchange = ev => { const f = ev.target.files[0]; if (f) importGarage(f); };
    imp.onclick = () => impFile.click();
    backup.append(exp, imp, impFile);
    card.appendChild(backup);
  });
}

function openEditBudget() {
  openModal('Annual budget', 'Your target spend on the car for the year.', card => {
    card.appendChild(field('Budget (SAR / year)', `<input id="m_budget" type="number" inputmode="numeric" value="${state.budget.annual}">`));
    const b = el('button', 'btn primary block', t('Save'));
    b.onclick = async () => { const v = parseInt($('#m_budget').value, 10); if (!isNaN(v)) state.budget.annual = v; const ok = await save(); closeModal(); go('budget'); if (ok) toast('Budget updated'); };
    card.appendChild(b);
  });
}

function openServiceDetail(s) {
  const st = serviceStatus(s);
  openModal(s.name, s.cat, card => {
    const pillTxt = t(st.level === 'danger' ? 'Overdue' : st.level === 'warn' ? 'Due soon' : 'On track');
    const box = el('div');
    box.innerHTML = `
      <div style="margin:2px 0 14px"><span class="pill ${st.level}">${pillTxt}</span></div>
      <div class="detail-row"><span class="k">${t('Interval')}</span><span class="v">${fmt(svKm(s))} km / ${svMo(s)} mo${s.normalKm && s.normalKm !== s.intervalKm ? ` <span class="muted" style="font-size:11px">· ${t(state.severity === 'severe' ? 'dealer' : 'severe')} ${fmt(state.severity === 'severe' ? s.normalKm : s.intervalKm)}</span>` : ''}</span></div>
      <div class="detail-row"><span class="k">${t('Last done')}</span><span class="v">${fmt(s.lastKm)} km · ${new Date(s.lastDate + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
      <div class="detail-row"><span class="k">${t('Next due')}</span><span class="v">${fmt(st.dueKm)} km · ${st.dueDate.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
      <div class="detail-row"><span class="k">${t('Distance left')}</span><span class="v">${st.kmLeft <= 0 ? fmt(-st.kmLeft) + ' ' + t('km over') : fmt(st.kmLeft) + ' km'}</span></div>
      <div class="detail-row"><span class="k">${t('Est. cost')}</span><span class="v">${sar(s.cost)} SAR</span></div>
      ${s.pendingParts && s.pendingParts.length ? `<div class="log-pending ${s.pendingParts.some(n => partCrit(n) === 'high') ? 'danger' : s.pendingParts.some(n => partCrit(n) === 'med') ? 'warn' : 'ok'}" style="margin-top:14px">⚠️ ${t('Do next service')}: ${s.pendingParts.map(n => `${t(n)} <span class="crit">(${critLabel(n)})</span>`).join('، ')}</div>` : ''}
      ${s.note ? `<p class="muted" style="font-size:12.5px;margin-top:14px;line-height:1.5">${t(s.note)}</p>` : ''}`;
    card.appendChild(box);

    // Parts this service needs — pulled live from the Parts catalog
    const rel = partsForService(s);
    if (rel.length) {
      const total = rel.reduce((a, p) => a + partCheapest(p), 0);
      const pb = el('div');
      pb.style.marginTop = '18px';
      pb.innerHTML = `<div style="font-size:12px;font-weight:700;color:var(--text-2);margin-bottom:8px">${t('Parts for this service')} · ~${sar(total)} SAR</div>`;
      const pl = el('div', 'list');
      rel.forEach(p => {
        const it = el('div', 'item');
        it.innerHTML = `<div class="item-ic">${p.icon || '🔩'}</div><div class="item-main"><h3>${t(p.name)}</h3><p>${t('from')} ${sar(partCheapest(p))} SAR · ${p.options.length} ${t('options')}</p></div><div class="item-side"><span style="color:var(--accent-soft);font-size:12px;font-weight:600">${t('View ›')}</span></div>`;
        it.onclick = () => { closeModal(); go('parts', { openPart: p.id }); };
        pl.appendChild(it);
      });
      pb.appendChild(pl);
      card.appendChild(pb);
    }

    const row = el('div', 'fab-row');
    row.style.marginTop = '18px';
    const done = el('button', 'btn primary', iconSvg('check') + t('Mark done now'));
    done.style.flex = '1';
    done.onclick = () => { closeModal(); openLogConfirm([s], { onDone: () => { go(current); toast(`${t(s.name)} ${t('logged ✓')}`); } }); };
    const edit = el('button', 'btn', t('Edit'));
    edit.onclick = () => openEditService(s);
    row.append(done, edit);
    card.appendChild(row);
  });
}

function markServiceDone(s) {
  s.lastKm = state.car.odometer;
  s.lastDate = isoDate(today());
  // record it in the work history
  state.history.push({ id: uid(), name: s.name, icon: s.icon || '🔧', date: isoDate(today()), odometer: state.car.odometer, cost: s.cost || 0, cat: 'Maintenance', note: '' });
  // log the spend
  if (s.cost > 0) state.spending.push({ id: uid(), date: isoDate(today()), cat: 'Maintenance', desc: s.name, amount: s.cost, odometer: state.car.odometer });
  save(); // fire-and-forget: nothing downstream reads the result
}

function openAddHistory(e, prefill) {
  const editing = !!e;
  const p = e || prefill || {}; // prefill = { name, icon, cat, odometer, cost } from the plan
  const cats = ['Maintenance', 'Tires', 'Parts', 'Fuel', 'Electrical', 'Other'];
  openModal(editing ? 'Edit service record' : 'Log a past service', editing ? '' : 'Record work already done on your car.', card => {
    card.appendChild(field('Service', `<input id="h_name" value="${p.name || ''}" placeholder="${t('e.g. Timing chain inspection')}">`));
    const r0 = el('div', 'field-row');
    r0.append(field('Icon (emoji)', `<input id="h_icon" value="${p.icon || '🔧'}" maxlength="2">`),
      field('Category', `<select id="h_cat">${cats.map(c => `<option value="${c}" ${p.cat === c ? 'selected' : ''}>${t(c)}</option>`).join('')}</select>`));
    card.appendChild(r0);
    const r1 = el('div', 'field-row');
    r1.append(field('Date', `<input id="h_date" type="date" value="${e ? e.date : isoDate(today())}">`),
      field('Odometer (km)', `<input id="h_odo" type="number" value="${p.odometer != null ? p.odometer : state.car.odometer}">`));
    card.appendChild(r1);
    card.appendChild(field('Cost (SAR)', `<input id="h_cost" type="number" value="${p.cost != null ? p.cost : 0}">`));
    card.appendChild(field('Note', `<textarea id="h_note" rows="2">${e ? (e.note || '') : ''}</textarea>`));
    let hphoto = e ? (e.photo || '') : '';
    card.appendChild(field('Receipt / invoice', ''));
    card.appendChild(photoPicker(hphoto, v => hphoto = v));
    if (!editing) {
      const chk = el('div', 'field');
      chk.innerHTML = `<label style="display:flex;align-items:center;gap:9px;font-size:13px;color:var(--text);font-weight:500;cursor:pointer">
        <input type="checkbox" id="h_spend" checked style="width:auto;accent-color:var(--accent)"> ${t('Also add this cost to Budget')}</label>`;
      card.appendChild(chk);
    }
    const b = el('button', 'btn primary block', editing ? t('Save changes') : t('Add to history'));
    b.onclick = async () => {
      const name = $('#h_name').value.trim();
      if (!name) return toast('Service name required', 'warn');
      const obj = {
        id: e ? e.id : uid(), name, icon: $('#h_icon').value.trim() || '🔧', cat: $('#h_cat').value,
        date: $('#h_date').value || isoDate(today()), odometer: +$('#h_odo').value || 0,
        cost: +$('#h_cost').value || 0, note: $('#h_note').value.trim(), photo: hphoto
      };
      if (e) Object.assign(e, obj);
      else {
        state.history.push(obj);
        if ($('#h_spend').checked && obj.cost > 0) state.spending.push({ id: uid(), date: obj.date, cat: obj.cat, desc: obj.name, amount: obj.cost, odometer: obj.odometer });
        // logged from the plan → re-baseline that service so the plan re-times itself
        if (prefill && prefill.serviceId) {
          const sv = state.services.find(x => x.id === prefill.serviceId);
          if (sv && obj.odometer > 0) { sv.lastKm = obj.odometer; sv.lastDate = obj.date; }
        }
      }
      const ok = await save(); closeModal(); go('maintenance'); if (ok) toast(editing ? 'Record updated' : 'Service logged ✓');
    };
    card.appendChild(b);
    if (editing) {
      const del = el('button', 'btn block ghost', t('Delete record'));
      del.style.marginTop = '8px'; del.style.color = 'var(--danger)';
      del.onclick = async () => { state.history = state.history.filter(x => x.id !== e.id); const ok = await save(); closeModal(); go('maintenance'); if (ok) toast('Record deleted'); };
      card.appendChild(del);
    }
  });
}

function openEditService(s) {
  const editing = !!s;
  openModal(editing ? 'Edit service' : 'New service', 'Set the interval and last service point.', card => {
    card.appendChild(field('Name', `<input id="s_name" value="${s ? s.name : ''}" placeholder="${t('e.g. Timing chain check')}">`));
    card.appendChild(field('Icon (emoji)', `<input id="s_icon" value="${s ? s.icon : '🔧'}" maxlength="2">`));
    const row1 = el('div', 'field-row');
    row1.append(field('Interval (km)', `<input id="s_ikm" type="number" value="${s ? s.intervalKm : 10000}">`),
      field('Interval (months)', `<input id="s_imo" type="number" value="${s ? s.intervalMonths : 12}">`));
    card.appendChild(row1);
    const row1b = el('div', 'field-row');
    row1b.append(field('Dealer interval (km)', `<input id="s_nkm" type="number" value="${s && s.normalKm ? s.normalKm : ''}" placeholder="${t('same as above')}">`),
      field('Dealer interval (mo)', `<input id="s_nmo" type="number" value="${s && s.normalMonths ? s.normalMonths : ''}" placeholder="${t('same as above')}">`));
    card.appendChild(row1b);
    const row2 = el('div', 'field-row');
    row2.append(field('Last done (km)', `<input id="s_lkm" type="number" value="${s ? s.lastKm : state.car.odometer}">`),
      field('Last done (date)', `<input id="s_ldate" type="date" value="${s ? s.lastDate : isoDate(today())}">`));
    card.appendChild(row2);
    const row3 = el('div', 'field-row');
    row3.append(field('Category', `<input id="s_cat" value="${s ? s.cat : 'General'}">`),
      field('Est. cost (SAR)', `<input id="s_cost" type="number" value="${s ? s.cost : 0}">`));
    card.appendChild(row3);
    card.appendChild(field('Note', `<textarea id="s_note" rows="2">${s ? (s.note || '') : ''}</textarea>`));
    const b = el('button', 'btn primary block', t('Save service'));
    b.onclick = async () => {
      const name = $('#s_name').value.trim();
      if (!name) return toast('Name is required', 'warn');
      const obj = {
        id: s ? s.id : uid(), name, icon: $('#s_icon').value.trim() || '🔧',
        cat: $('#s_cat').value.trim() || 'General',
        intervalKm: +$('#s_ikm').value || 10000, intervalMonths: +$('#s_imo').value || 12,
        normalKm: +$('#s_nkm').value || null, normalMonths: +$('#s_nmo').value || null,
        lastKm: +$('#s_lkm').value || 0, lastDate: $('#s_ldate').value || isoDate(today()),
        cost: +$('#s_cost').value || 0, note: $('#s_note').value.trim()
      };
      if (s) Object.assign(s, obj); else state.services.push(obj);
      const ok = await save(); closeModal(); go('maintenance'); if (ok) toast(editing ? 'Service updated' : 'Service added');
    };
    card.appendChild(b);
    if (editing) {
      const del = el('button', 'btn block ghost', t('Delete service'));
      del.style.marginTop = '8px'; del.style.color = 'var(--danger)';
      del.onclick = async () => { state.services = state.services.filter(x => x.id !== s.id); const ok = await save(); closeModal(); go('maintenance'); if (ok) toast('Service deleted'); };
      card.appendChild(del);
    }
  });
}

function openLogService() {
  openModal('Log a service', 'A single service, or a whole plan visit at once.', card => {
    const single = el('div', 'card plan-setup-banner');
    single.innerHTML = `<div class="r-ic">🔧</div><div style="flex:1"><h3>${t('Single service')}</h3><p class="muted" style="font-size:12px;margin-top:2px">${t('Pick one thing you just had done.')}</p></div>`;
    const bSingle = el('button', 'btn', t('Choose'));
    bSingle.onclick = () => { closeModal(); openLogSingleService(); };
    single.appendChild(bSingle);
    card.appendChild(single);

    const plan = el('div', 'card plan-setup-banner');
    plan.innerHTML = `<div class="r-ic">🗓️</div><div style="flex:1"><h3>${t('Plan visit')}</h3><p class="muted" style="font-size:12px;margin-top:2px">${t('A group of services from your plan, done together.')}</p></div>`;
    const bPlan = el('button', 'btn', t('Choose'));
    bPlan.onclick = () => { closeModal(); openLogPlanVisit(); };
    plan.appendChild(bPlan);
    card.appendChild(plan);
  });
}

function openLogSingleService() {
  openModal('Log a service', 'Pick what you just had done — it resets the clock and adds the cost.', card => {
    const list = el('div', 'list');
    servicesRanked().forEach(({ s, st }) => {
      const it = serviceItem(s, st);
      it.onclick = () => { closeModal(); openLogConfirm([s], { onDone: () => { go(current); toast(`${t(s.name)} ${t('logged ✓')}`); } }); };
      list.appendChild(it);
    });
    card.appendChild(list);
  });
}

function openLogPlanVisit() {
  const milestones = planForward().slice(0, 6);
  openModal('Log a plan visit', 'Pick an upcoming group of services — logs everything in it at once.', card => {
    if (!milestones.length) { card.appendChild(emptyState('🗓️', 'Nothing scheduled — you’re all caught up!')); return; }
    const list = el('div', 'list');
    milestones.forEach(ms => {
      const it = el('div', 'item');
      it.innerHTML = `
        <div class="item-ic">${ms.major ? '🛠️' : '🗓️'}</div>
        <div class="item-main"><h3>${fmt(ms.km)} km${ms.major ? ' · ' + t('Major service') : ''}</h3><p>${ms.items.map(s => t(s.name)).join(', ')}</p></div>
        <div class="item-side"><span style="color:var(--accent-soft);font-size:12px;font-weight:600">${t('Log ›')}</span></div>`;
      it.onclick = () => { closeModal(); openLogConfirm(ms.items, { checklist: true, onDone: () => { go('maintenance'); } }); };
      list.appendChild(it);
    });
    card.appendChild(list);
  });
}

function openAddSpending(e) {
  const editing = !!e;
  const cats = ['Maintenance', 'Tires', 'Parts', 'Fuel', 'Electrical', 'Insurance', 'Other'];
  openModal(editing ? 'Edit expense' : 'Add spending', 'Log money spent on the car.', card => {
    if (!editing) {
      const partOpts = state.parts.map((p, i) => `<option value="part:${i}">${t(p.name)} · ${sar(Math.min(...p.options.map(o => o.price)))} SAR</option>`).join('');
      card.appendChild(field('Quick pick <span class="muted" style="font-weight:500">— autofill from a part</span>',
        `<select id="x_pick"><option value="">${t('Start from scratch…')}</option>${partOpts}</select>`));
    }
    card.appendChild(field('Description', `<input id="x_desc" value="${e ? e.desc : ''}" placeholder="${t('e.g. New front brake pads')}">`));
    const row = el('div', 'field-row');
    row.append(field('Amount (SAR)', `<input id="x_amt" type="number" inputmode="numeric" value="${e ? e.amount : ''}">`),
      field('Date', `<input id="x_date" type="date" value="${e ? e.date : isoDate(today())}">`));
    card.appendChild(row);
    card.appendChild(field('Category', `<select id="x_cat">${cats.map(c => `<option value="${c}" ${e && e.cat === c ? 'selected' : ''}>${t(c)}</option>`).join('')}</select>`));
    card.appendChild(field('Odometer at time (km)', `<input id="x_odo" type="number" value="${e ? e.odometer : state.car.odometer}">`));
    let xphoto = e ? (e.photo || '') : '';
    card.appendChild(field('Receipt / invoice', ''));
    card.appendChild(photoPicker(xphoto, v => xphoto = v));
    if (!editing) {
      $('#x_pick').onchange = function () {
        if (!this.value) return;
        const p = state.parts[+this.value.split(':')[1]];
        $('#x_desc').value = p.name;
        $('#x_amt').value = Math.min(...p.options.map(o => o.price));
        $('#x_cat').value = p.cat === 'Tires' ? 'Tires' : p.cat === 'Electrical' ? 'Electrical' : 'Parts';
      };
    }
    const b = el('button', 'btn primary block', t('Save'));
    b.onclick = async () => {
      const desc = $('#x_desc').value.trim(); const amt = +$('#x_amt').value;
      if (!desc) return toast('Description required', 'warn');
      if (isNaN(amt)) return toast('Amount required', 'warn');
      const obj = { id: e ? e.id : uid(), desc, amount: amt, date: $('#x_date').value || isoDate(today()), cat: $('#x_cat').value, odometer: +$('#x_odo').value || state.car.odometer, photo: xphoto };
      if (e) Object.assign(e, obj); else state.spending.push(obj);
      const ok = await save(); closeModal(); go('budget'); if (ok) toast(editing ? 'Expense updated' : 'Expense added');
    };
    card.appendChild(b);
    if (editing) {
      const del = el('button', 'btn block ghost', t('Delete expense'));
      del.style.marginTop = '8px'; del.style.color = 'var(--danger)';
      del.onclick = async () => { state.spending = state.spending.filter(x => x.id !== e.id); const ok = await save(); closeModal(); go('budget'); if (ok) toast('Expense deleted'); };
      card.appendChild(del);
    }
  });
}

function openEditPart(p) {
  const editing = !!p;
  openModal(editing ? 'Edit part' : 'New part', 'Add the OEM option and any alternatives.', card => {
    card.appendChild(field('Part name', `<input id="p_name" value="${p ? p.name : ''}" placeholder="${t('e.g. Front Brake Pads')}">`));
    const row = el('div', 'field-row');
    const curCat = p ? p.cat : 'Engine';
    const catList = [...new Set(['Engine', 'Interior', 'Brakes', 'Exterior', 'Electrical', 'Drivetrain', 'Suspension', 'A/C', 'Tires', 'General', ...state.parts.map(x => x.cat), curCat])];
    row.append(field('Icon (emoji)', `<input id="p_icon" value="${p ? p.icon : '🔩'}" maxlength="2">`),
      field('Category', `<select id="p_cat">${catList.map(c => `<option value="${c}" ${c === curCat ? 'selected' : ''}>${t(c)}</option>`).join('')}</select>`));
    card.appendChild(row);
    card.appendChild(field('PartSouq part no. (optional — enables live-price link)', `<input id="p_psq" value="${p && p.partsouq ? p.partsouq : ''}" placeholder="e.g. PE0114302A">`));

    const optsWrap = el('div');
    const lbl = el('div'); lbl.style.cssText = 'font-size:12px;font-weight:600;color:var(--text-2);margin:6px 0';
    lbl.textContent = t('Options (OEM & alternatives)');
    card.appendChild(lbl);
    card.appendChild(optsWrap);

    const opts = p ? JSON.parse(JSON.stringify(p.options)) : [{ tag: 'OEM', brand: '', partNo: '', price: 0, store: '', note: '' }];
    function drawOpts() {
      optsWrap.innerHTML = '';
      opts.forEach((o, i) => {
        const box = el('div', 'card');
        box.style.cssText = 'padding:12px;margin-bottom:10px';
        box.innerHTML = `
          <div class="field-row" style="margin-bottom:8px">
            <div class="field" style="margin:0"><label>${t('Type')}</label><select data-k="tag"><option ${o.tag === 'OEM' ? 'selected' : ''}>OEM</option><option ${o.tag !== 'OEM' ? 'selected' : ''}>ALT</option></select></div>
            <div class="field" style="margin:0"><label>${t('Price (SAR)')}</label><input type="number" data-k="price" value="${o.price}"></div>
          </div>
          <div class="field" style="margin:0 0 8px"><label>${t('Brand / product')}</label><input data-k="brand" value="${o.brand || ''}"></div>
          <div class="field-row" style="margin-bottom:8px">
            <div class="field" style="margin:0"><label>${t('Part no.')}</label><input data-k="partNo" value="${o.partNo || ''}"></div>
            <div class="field" style="margin:0"><label>${t('Store')}</label><input data-k="store" value="${o.store || ''}"></div>
          </div>
          <div class="field" style="margin:0"><label>${t('Note')}</label><input data-k="note" value="${o.note || ''}"></div>`;
        box.querySelectorAll('[data-k]').forEach(inp => inp.oninput = () => { o[inp.dataset.k] = inp.type === 'number' ? +inp.value : inp.value; });
        if (opts.length > 1) {
          const rm = el('button', 'btn ghost', t('Remove option')); rm.style.cssText = 'margin-top:8px;font-size:12px;padding:7px;color:var(--danger)';
          rm.onclick = () => { opts.splice(i, 1); drawOpts(); };
          box.appendChild(rm);
        }
        optsWrap.appendChild(box);
      });
    }
    drawOpts();
    const addOpt = el('button', 'btn block ghost', iconSvg('plus') + t('Add option'));
    addOpt.style.marginBottom = '14px';
    addOpt.onclick = () => { opts.push({ tag: 'ALT', brand: '', partNo: '', price: 0, store: '', note: '' }); drawOpts(); };
    card.appendChild(addOpt);

    const b = el('button', 'btn primary block', t('Save part'));
    b.onclick = async () => {
      const name = $('#p_name').value.trim();
      if (!name) return toast('Part name required', 'warn');
      const valid = opts.filter(o => o.brand.trim());
      if (!valid.length) return toast('Add at least one option', 'warn');
      const obj = { id: p ? p.id : uid(), name, icon: $('#p_icon').value.trim() || '🔩', cat: $('#p_cat').value.trim() || 'General', partsouq: $('#p_psq').value.trim().replace(/[^A-Za-z0-9]/g, ''), options: valid };
      if (p) Object.assign(p, obj); else state.parts.push(obj);
      const ok = await save(); closeModal(); go('parts'); if (ok) toast(editing ? 'Part updated' : 'Part added');
    };
    card.appendChild(b);
    if (editing) {
      const del = el('button', 'btn block ghost', t('Delete part'));
      del.style.marginTop = '8px'; del.style.color = 'var(--danger)';
      del.onclick = async () => { state.parts = state.parts.filter(x => x.id !== p.id); const ok = await save(); closeModal(); go('parts'); if (ok) toast('Part deleted'); };
      card.appendChild(del);
    }
  });
}

/* ============================================================
   SHARED UI BITS
   ============================================================ */
function sectionTitle(title, linkTxt, onLink, badge) {
  const s = el('div', 'section-title');
  const left = el('div', 'section-title-left');
  left.appendChild(el('h2', null, t(title)));
  if (badge) left.appendChild(el('span', 'section-title-badge', badge));
  s.appendChild(left);
  if (linkTxt && onLink) { const b = el('button', 'link', t(linkTxt)); b.onclick = onLink; s.appendChild(b); }
  return s;
}
function pageIntro(title, sub) {
  const d = el('div');
  d.style.margin = '6px 4px 8px';
  d.innerHTML = `<h2 style="font-size:22px;font-weight:800;letter-spacing:-.4px">${t(title)}</h2><p class="muted" style="font-size:13px;margin-top:4px;line-height:1.5">${t(sub)}</p>`;
  return d;
}
function emptyState(emoji, txt) {
  const e = el('div', 'empty');
  e.innerHTML = `<div class="e-emoji">${emoji}</div><p>${t(txt)}</p>`;
  return e;
}
function iconSvg(name) {
  const paths = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M20 6 9 17l-5-5"/>'
  };
  return `<svg viewBox="0 0 24 24">${paths[name] || ''}</svg>`;
}
function toast(msg, kind) {
  const host = $('#toastHost');
  const node = el('div', 'toast', `<span class="dot" style="background:${kind === 'warn' ? 'var(--warn)' : 'var(--ok)'}"></span>${t(msg)}`);
  host.appendChild(node);
  setTimeout(() => { node.style.opacity = '0'; node.style.transform = 'translateY(10px)'; node.style.transition = '.3s'; setTimeout(() => node.remove(), 300); }, 2200);
}

/* ---------- theme ---------- */
function systemTheme() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  $('meta[name=theme-color]').setAttribute('content', t === 'light' ? '#eef0f4' : '#0f1013');
}
/* Stored preference: 'light' | 'dark', or absent meaning "follow the device". */
function themePref() {
  try { return localStorage.getItem('garage.theme') || 'system'; } catch (e) { return 'system'; }
}
function setThemePref(p) {
  try {
    if (p === 'system') localStorage.removeItem('garage.theme');
    else localStorage.setItem('garage.theme', p);
  } catch (e) {}
  applyTheme(p === 'system' ? systemTheme() : p);
}
$('#themeToggle').onclick = () => {
  const next = nextTheme(themePref());
  setThemePref(next);
  toast(next === 'system' ? 'Theme: follows device' : next === 'light' ? 'Theme: light' : 'Theme: dark');
};

/* ---------- language (Arabic / English + RTL) ---------- */
const NAV_KEYS = { dashboard: 'Dashboard', maintenance: 'Maintenance', parts: 'Parts', fuel: 'Fuel', budget: 'Budget', reports: 'Reports' };
function applyNavLabels() {
  document.querySelectorAll('.tab').forEach(tab => {
    const span = tab.querySelector('span'); const k = NAV_KEYS[tab.dataset.route];
    if (span && k) span.textContent = t(k);
  });
}
function applyLang(l) {
  lang = l;
  const root = document.documentElement;
  root.setAttribute('lang', l);
  root.setAttribute('dir', l === 'ar' ? 'rtl' : 'ltr');
  try { localStorage.setItem('garage.lang', l); } catch (e) {}
  applyNavLabels();
  renderTopbar();
  go(current);
}
// follow the device unless the user has explicitly picked light or dark
setThemePref(themePref());
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', e => {
    if (themePref() === 'system') applyTheme(e.matches ? 'light' : 'dark');
  });
}

/* ---------- accent follows the car colour ---------- */
const CAR_ACCENTS = [
  [['soul red', 'red'], '#d6203c', '#ff5c6e'],
  [['blue', 'crystal'], '#2f6df0', '#6fa8ff'],
  [['green', 'olive'], '#1f9d6b', '#4be0a6'],
  [['bronze', 'copper', 'brown', 'zircon'], '#b0702c', '#e0a860'],
  [['silver', 'sonic', 'aluminium', 'aluminum'], '#7c879a', '#a8b3c6'],
  [['white', 'snowflake', 'arctic', 'platinum', 'ceramic'], '#5f86b3', '#93b3d8'],
  [['black', 'jet'], '#c0142c', '#ff5c6e'],
  [['gray', 'grey', 'machine', 'meteor', 'titanium', 'polymetal', 'graphite', 'gunmetal'], '#5b6b82', '#8ea1bd']
];
function hexToRgb(h) { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
function rgbToHex(r, g, b) { return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join(''); }
function darkenHex(hex, f) { const [r, g, b] = hexToRgb(hex); return rgbToHex(r * f, g * f, b * f); }
function accentForColor(name) {
  const c = (name || '').toLowerCase();
  const hit = CAR_ACCENTS.find(([keys]) => keys.some(k => c.includes(k)));
  return hit ? [hit[1], hit[2]] : ['#d6203c', '#ff5c6e'];
}

/* real-paint swatches for the colour dropdown */
const COLOR_SWATCHES = {
  'Soul Red Metallic (Code 41V)': '#a5141b',
  'Snowflake White Pearl Mica (Code 25D)': '#eef0f2',
  'Jet Black Mica (Code 41W)': '#15161a',
  'Deep Crystal Blue Mica (Code 42M)': '#1e3a6e',
  'Blue Reflex Mica (Code 42B)': '#2f6fae',
  'Meteor Gray Mica (Code 42A)': '#59626e',
  'Liquid Silver Metallic (Code 38P)': '#b9bec5',
  'Titanium Flash Mica (Code 42S)': '#6d6e72'
};
function swatchFor(name) { return COLOR_SWATCHES[name] || accentForColor(name)[0]; }
function applyAccent() {
  const [acc, soft] = accentForColor(state.car && state.car.color);
  const [r, g, b] = hexToRgb(acc);
  const s = document.documentElement.style;
  s.setProperty('--accent', acc);
  s.setProperty('--accent-soft', soft);
  s.setProperty('--accent-2', darkenHex(acc, 0.72));
  s.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, .35)`);
}

/* ---------- boot ---------- */
$('#settingsBtn').onclick = openSettings;
$('#openProfile').onclick = openSettings;
$('#garageBtn').onclick = openGarage;
lang = localStorage.getItem('garage.lang') || 'en';
document.documentElement.setAttribute('lang', lang);
document.documentElement.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
applyNavLabels();

openStorage()
  .then(loadAll)
  .then(({ garage: g, photos }) => {
    photoBlobs = photos || {};
    const h = hydrate(g, photoBlobs);
    garage = h.garage;
    state = h.state;
    if (!g || !g.vehicles || !g.vehicles.length) return save();          // first run — persist the seed
  })
  .then(() => {
    booted = true;
    applyAccent();
    renderTopbar();
    go('dashboard');
  })
  .catch(err => {
    document.getElementById('view').innerHTML =
      `<div class="card" style="padding:20px"><h3>${t('Could not open your garage')}</h3><p style="color:var(--text-2);margin-top:8px">${t('Your data is safe. Please reload the page.')}</p></div>`;
    console.error(err);
  });

/* ---------- PWA: offline + installable ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
