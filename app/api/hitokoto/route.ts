import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface HitokotoResult {
  text: string;
  from: string;
}

// ==================== 内置一言库（主数据源，不依赖外网）====================
const HITOKOTOS: HitokotoResult[] = [
  { text: "生活不止眼前的苟且，还有诗和远方。", from: "高晓松" },
  { text: "我所做的事，常常是出于懒惰。", from: "加缪" },
  { text: "愿你历尽千帆，归来仍是少年。", from: "无名" },
  { text: "山有木兮木有枝，心悦君兮君不知。", from: "佚名" },
  { text: "千里之行，始于足下。", from: "老子" },
  { text: "万物皆有裂痕，那是光照进来的地方。", from: "莱昂纳德·科恩" },
  { text: "世事一场大梦，人生几度秋凉。", from: "苏轼" },
  { text: "在你想要放弃的那一刻，想想当初为什么坚持走到了这里。", from: "无名" },
  { text: "弱者等待时机，强者创造时机。", from: "居里夫人" },
  { text: "时间会冲淡一切，也会证明一切。", from: "无名" },
  { text: "追风赶月莫停留，平芜尽处是春山。", from: "无名" },
  { text: "星光不问赶路人，时光不负有心人。", from: "无名" },
  { text: "心有猛虎，细嗅蔷薇。", from: "西格里夫·萨松" },
  { text: "黑夜给了我黑色的眼睛，我却用它寻找光明。", from: "顾城" },
  { text: "人间有味是清欢。", from: "苏轼" },
  { text: "凡是过往，皆为序章。", from: "莎士比亚" },
  { text: "道阻且长，行则将至。", from: "荀子" },
  { text: "心之所向，无问西东。", from: "无名" },
  { text: "岁月静好，现世安稳。", from: "张爱玲" },
  { text: "不忘初心，方得始终。", from: "佚名" },
  { text: "你若盛开，清风自来。", from: "三毛" },
  { text: "所有的美好都发生在夏天。", from: "汪曾祺" },
  { text: "热爱漫无边际，生活自有分寸。", from: "李大钊" },
  { text: "知止而后有定，定而后能静。", from: "大学" },
  { text: "天行健，君子以自强不息。", from: "周易" },
];

// 类型过滤映射（索引须与 HITOKOTOS 数组一一对应，共 25 条，索引 0-24）
const TYPE_FILTER: Record<string, number[]> = {
  a: [...Array(7)].map((_, i) => i),       // 古代文学前 7 句 (0-6)
  b: [10, 11, 12, 13, 14],                 // 现代诗歌
  c: [15, 16, 17, 18, 19],                 // 诗词古文
  d: [20, 21, 22, 23, 24],                 // 原创语录
  f: [7, 8, 9, 0, 2],                      // 其他常见分类（原 25/26 越界，已修正为合法索引）
};

let currentIndex = 0;

/** HITOKOTOS 数组长度（25 条）；轮询一轮后重置防无限递增 */
const HITOKOTO_COUNT = 25;

export async function GET(request: Request) {
  const type = new URL(request.url).searchParams.get("c") || "";
  
  let pool = HITOKOTOS;
  if (type && TYPE_FILTER[type]) {
    pool = TYPE_FILTER[type].map(i => HITOKOTOS[i]).filter(Boolean);
  }
  
  // 轮询返回，确保连续刷新不会重复
  const result = pool[currentIndex % pool.length];
  currentIndex++;
  
  // 每轮 HITOKOTO_COUNT 次调用后重置为 0
  if (currentIndex >= HITOKOTO_COUNT) currentIndex = 0;
  
  return NextResponse.json(result);
}
