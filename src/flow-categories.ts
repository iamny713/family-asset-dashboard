export const flowCategories = {
  income: ['급여', '보너스', '주식 보너스 판매', '사업·부업', '이자·배당', '임대수입', '받은 경조금', '기타 수입'],
  expense: ['식비', '생활용품', '주거·공과금', '교통', '통신', '의료', '교육·육아', '보험', '쇼핑', '여가·여행', '구독', '세금', '대출 이자', '카드값', '축의금', '기타 경조비', '기타 지출'],
} as const;

export function isFlowCategory(kind: keyof typeof flowCategories, category: string) {
  return flowCategories[kind].some(value => value === category);
}
