/* ============================================================
   i18n — Arabic / English. t() keys on the English string, so any
   string not yet in the dictionary safely falls back to English.
   ============================================================ */
'use strict';
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const api = factory();
  if (isNode) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : globalThis, function () {

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
  'Only compatible parts are shown. Shared consumables are marked ↔; vehicle-locked parts are marked 🔒.': 'تظهر القطع المتوافقة فقط. المستهلكات المشتركة بعلامة ↔، والقطع الخاصة بالسيارة بعلامة 🔒.',
  'Shared consumable': 'مستهلك مشترك', 'This vehicle only': 'لهذه السيارة فقط',
  'Shared consumable across compatible Mazda models': 'مستهلك مشترك بين طرازات مازدا المتوافقة',
  'Locked to': 'مخصص لـ', 'this vehicle': 'هذه السيارة',
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
  'SAR total': 'إجمالي الريال', 'Last service': 'آخر خدمة', 'OF BUDGET': 'من الميزانية', 'of budget': 'من الميزانية',
  /* Year-free: callers append the live year, so this phrase never goes stale. */
  'Spent in': 'المصروف في',
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
  'Throttle Body & MAF Cleaning': 'تنظيف بوابة الخانق وحساس الهواء', 'Spark Plugs (x4)': 'بواجي الإشعال (×4)', 'Spark Plugs (x6)': 'بواجي الإشعال (×6)', 'Fuel Filter': 'فلتر الوقود',
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
  'Cost': 'التكلفة', 'Notes': 'ملاحظات', 'Everything is up to date 🎉': 'كل شيء محدّث 🎉',
  'Generated': 'أُنشئ في', 'Odometer ': 'العداد ', 'Current odometer (km)': 'العداد الحالي (كم)', 'No service history recorded yet.': 'لا يوجد سجل صيانة بعد.',
  'Service History Report': 'تقرير سجل الصيانة', 'No purchases or spending recorded yet.': 'لا توجد مشتريات أو مصروفات بعد.', 'Entries': 'إدخالات', 'Categories': 'الفئات',
  'By category': 'حسب الفئة', 'Amount': 'المبلغ', 'Share': 'النسبة', 'All purchases': 'كل المشتريات', 'Item': 'البند', 'Purchases & Spending Report': 'تقرير المشتريات والمصروفات',
  'Health score': 'درجة الحالة', 'Lifetime service cost': 'تكلفة الصيانة الإجمالية', 'Upcoming &amp; overdue services': 'الخدمات القادمة والمتأخرة',
  'Status': 'الحالة', 'Distance': 'المسافة', 'Est. cost': 'التكلفة التقديرية', 'Estimated total': 'الإجمالي التقديري', 'Vehicle Summary Report': 'تقرير ملخص المركبة',
  'Garage · Mazda 3 care app': 'Garage · تطبيق العناية بمازدا 3', 'Report generated': 'صدر التقرير',
  // part names
  'Engine Oil 5W-30': 'زيت محرك 5W-30', 'Oil Filter': 'فلتر الزيت', 'Fuel System Cleaner (additive)': 'منظف نظام الوقود (إضافة)', 'Cabin A/C Filter': 'فلتر مكيف المقصورة',
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
  'No spending logged yet.': 'لا توجد مصروفات مسجلة بعد.',
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
  'Quick pick': 'اختيار سريع', '— autofill from a part': '— تعبئة تلقائية من قطعة',
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

  // accounts
  'Account': 'الحساب',
  'Settings': 'الإعدادات',
  'Sign in': 'تسجيل الدخول',
  'Sign up': 'إنشاء حساب',
  'Sign out': 'تسجيل الخروج',
  'Email': 'البريد الإلكتروني',
  'Password': 'كلمة المرور',
  'Signed in as': 'مسجّل الدخول باسم',
  'Not signed in': 'غير مسجّل الدخول',
  'Your garage stays on this device.': 'تبقى بياناتك على هذا الجهاز.',
  'Synced': 'تمت المزامنة',
  'Waiting to sync': 'في انتظار المزامنة',
  'Couldn’t reach your garage. Check your connection and try again.': 'تعذّر الوصول إلى بياناتك. تحقّق من اتصالك وحاول مرة أخرى.',
  'Check your email to confirm your account.': 'تحقّق من بريدك لتأكيد حسابك.',
  'Wrong email or password.': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  'That email is already registered. Sign in instead.': 'هذا البريد الإلكتروني مسجّل بالفعل. سجّل الدخول بدلاً من ذلك.',
  'Password must be at least 6 characters.': 'يجب أن تكون كلمة المرور 6 أحرف على الأقل.',
  'Keep this device’s garage': 'الاحتفاظ ببيانات هذا الجهاز',
  'Use my account’s garage': 'استخدام بيانات حسابي',
  'You have data here and in your account': 'لديك بيانات هنا وفي حسابك',
  'Choose which one to keep. The other is replaced.': 'اختر أيهما تريد الاحتفاظ به. سيتم استبدال الآخر.'
};

  return { AR };
});
