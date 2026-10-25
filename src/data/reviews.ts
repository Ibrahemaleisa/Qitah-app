import type { Review } from '@/domain/types';

/** SAMPLE DATA — illustrative review text. Never shown as genuine customer feedback. */
export const reviews: Review[] = [
  { id: 'r1', target: { kind: 'product', productId: 'p-camry-pads-oem' }, rating: 5, author: 'عبدالله م.', daysAgo: 4, verifiedPurchase: true, body: { ar: 'نفس القطعة الأصلية اللي في الوكالة، الصوت اختفى تماماً والفرملة ثابتة.', en: 'Same part the dealer fits. Squeal is gone and braking feels consistent.' } },
  { id: 'r2', target: { kind: 'product', productId: 'p-camry-pads-oem' }, rating: 4, author: 'Faisal A.', daysAgo: 19, verifiedPurchase: true, body: { ar: 'جودة ممتازة، فقط السعر أعلى قليلاً من البدائل.', en: 'Excellent quality, just a little pricier than alternatives.' } },
  { id: 'r3', target: { kind: 'product', productId: 'p-camry-pads-ceramic' }, rating: 5, author: 'نورة س.', daysAgo: 9, verifiedPurchase: true, body: { ar: 'غبار أقل بكثير على الجنوط مقارنة بالسابقة.', en: 'Much less dust on the wheels than my previous pads.' } },
  { id: 'r4', target: { kind: 'product', productId: 'p-camry-pads-ceramic' }, rating: 3, author: 'Omar K.', daysAgo: 33, verifiedPurchase: false, body: { ar: 'جيدة لكن احتاجت فترة تعويد أطول.', en: 'Good, but needed a longer bedding-in period.' } },
  { id: 'r5', target: { kind: 'product', productId: 'p-toyota-oil-filter' }, rating: 5, author: 'سلطان ع.', daysAgo: 2, verifiedPurchase: true, body: { ar: 'وصل خلال يوم، تغليف أصلي.', en: 'Arrived in a day, genuine packaging.' } },
  { id: 'r6', target: { kind: 'product', productId: 'p-oil-5w30' }, rating: 5, author: 'Huda R.', daysAgo: 12, verifiedPurchase: true, body: { ar: 'المحرك أهدأ والزيت ثابت مع حرارة الصيف.', en: 'Engine is quieter and the oil holds up in summer heat.' } },
  { id: 'r7', target: { kind: 'product', productId: 'p-lc-rotor-oem' }, rating: 5, author: 'ماجد ق.', daysAgo: 21, verifiedPurchase: true, body: { ar: 'تركيب مثالي، لا اهتزاز على السرعات العالية.', en: 'Perfect fit, no vibration at highway speed.' } },
  { id: 'r8', target: { kind: 'product', productId: 'p-battery-70' }, rating: 4, author: 'Reem T.', daysAgo: 40, verifiedPurchase: true, body: { ar: 'أداء قوي حتى الآن، والتوصيل كان في نفس اليوم.', en: 'Strong so far, and delivery was same-day.' } },
  { id: 'r9', target: { kind: 'seller', sellerId: 's-riyadh-center' }, rating: 5, author: 'خالد ف.', daysAgo: 3, verifiedPurchase: true, body: { ar: 'تواصل سريع وأكدوا التوافق برقم الهيكل قبل الشحن.', en: 'Quick to respond and confirmed fitment by VIN before shipping.' } },
  { id: 'r10', target: { kind: 'seller', sellerId: 's-riyadh-center' }, rating: 4, author: 'Lama H.', daysAgo: 15, verifiedPurchase: true, body: { ar: 'التغليف ممتاز، تأخر الشحن يوماً واحداً.', en: 'Great packaging, shipment was one day late.' } },
  { id: 'r11', target: { kind: 'seller', sellerId: 's-brake-house' }, rating: 5, author: 'Yousef B.', daysAgo: 7, verifiedPurchase: true, body: { ar: 'يعرفون شغلهم في الفرامل، نصحوني بالقطعة المناسبة.', en: 'They know brakes and recommended the right part.' } },
  { id: 'r12', target: { kind: 'seller', sellerId: 's-salvage' }, rating: 4, author: 'تركي ن.', daysAgo: 26, verifiedPurchase: true, body: { ar: 'القطعة المستعملة كانت مطابقة للوصف والصور.', en: 'Used part matched the description and photos.' } },
  { id: 'r13', target: { kind: 'seller', sellerId: 's-eastern' }, rating: 4, author: 'Saad M.', daysAgo: 11, verifiedPurchase: false, body: { ar: 'أسعار جيدة وخيارات كثيرة.', en: 'Good prices and lots of choice.' } },
  { id: 'r14', target: { kind: 'seller', sellerId: 's-elite-oils' }, rating: 5, author: 'منيرة د.', daysAgo: 5, verifiedPurchase: true, body: { ar: 'أطلب منهم كل صيانة دورية، دائماً في الوقت.', en: 'I order every service from them — always on time.' } },
];

export function reviewsForProduct(productId: string): Review[] {
  return reviews.filter((r) => r.target.kind === 'product' && r.target.productId === productId);
}

export function reviewsForSeller(sellerId: string): Review[] {
  return reviews.filter((r) => r.target.kind === 'seller' && r.target.sellerId === sellerId);
}
