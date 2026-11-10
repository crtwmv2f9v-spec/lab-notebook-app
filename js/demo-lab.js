// Sample experiment records shown with ?demo (generic example data).
import { todayISO } from './model.js';

const SOLUTION_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAKAAAAB4CAIAAAD6wG44AAABDklEQVR42u3RMREAIAwAsSpBCWIrjq0mWJnZCrl7BZ+oWnq4sACwAAuwAAuwAAswYAEWYAEWYAEWYMACLMACLMACLMACDFiABfimMbNXgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAEDBgwYMGDAgAED/gpYgAUYsAWABViABViABVhnG9JjpvdRqp3hAAAAAElFTkSuQmCC';
const DEVICE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAKAAAAB4CAIAAAD6wG44AAABGklEQVR42u3RsQ0AEBBAUeMoDX+NrTR6G6hIxL3kT/BfmXPo44oFgAVYgAVYgAVYgAELsFIAR3TdDjBgwIABAwYMWIAFWIABAwacArjWtg8wYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCJAgwYMGDAgAEDFmABFmDAgAEfANbjAQYswAIswAIswAIMWN+0AAK9HyA4mQNXAAAAAElFTkSuQmCC';
const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return todayISO(d); };
const compact = (iso) => iso.replace(/-/g, '');

export function labDemoFiles() {
  const d0 = day(-3); const x1 = `${compact(d0)}-OECT-01`;
  const d1 = day(-1); const x2 = `${compact(d1)}-OECT-01`;
  const x3 = `${compact(d1)}-OECT-02`;
  const notebook = {
    title: '实验记录本（示例）', owner: '示例用户',
    volumes: [
      { id: 'oect', title: 'OECT 器件', number: 1, color: '#22335a', code: 'OECT', description: '打印 OECT：沟道、栅极与传感', created: day(-30) },
      { id: 'sample', title: 'Sample volume', number: 2, color: '#24453a', description: 'A tour of what a page can hold.', created: '2026-10-20' },
      { id: 'second-sample', title: 'Second sample', number: 3, color: '#5b2228', description: 'Shows links between volumes.', created: '2026-10-22' },
    ],
  };
  const reagents = [
    'id,name,spec,vendor,catalog,lot,cas,location,opened,expires,notes',
    `R-0001,PEDOT:PSS 凝胶（GOPS 交联）,打印墨水,示例供应商,,L2410A,,4 °C 冰箱 A2,${day(-20)},${day(12)},使用前回温 30 min`,
    'R-0002,GOPS,≥98%,示例供应商,440167,MKCQ1234,2530-83-8,干燥柜,,,',
    `R-0003,PBS 1×,pH 7.4,示例供应商,,P2410,,室温,${day(-10)},${day(40)},`,
    'R-0004,Ag 导电浆料,DIW 打印用,示例供应商,,AG-2409,,室温,,,',
  ].join('\n') + '\n';
  const sop = `---
id: SOP-DEMO-OECT-TR-v1
title: OECT 转移曲线测试（示例）
version: v1
source: 05_SOP/示例.pdf
reagents: [R-0003]
variables: [GOPS (wt%), 退火 (°C)]
results: [gm_max (mS), Vth (V), on/off]
tags: [oect, transfer]
---

## 步骤

1. 加 100 µL PBS，浸泡 60 min。
2. 脉冲预处理 20 个周期，直到连续 3 条 transfer 的开态 ID 相差 < 2%。
3. 正式 transfer：VD = −0.3 V，VG −0.2 → +0.6 → −0.2 V，10 mV 步长，20 mV/s。
4. 再测一条 transfer，检查不可逆漂移。
`;
  const page = (fm, body) => `---\n${fm}\n---\n\n${body}\n`;
  return {
    'notebook.json': `${JSON.stringify(notebook, null, 2)}\n`,
    'library/reagents.csv': reagents,
    'methods/M-0001.json': `${JSON.stringify({ id: 'M-0001', vol: 'oect', papers: ['A1'], title: '沟道 ROI 圈定与面积测量', cat: '图像分析', status: '待写入', tags: ['ImageJ', '显微镜'],
      body: '1. 显微镜图像（10×，比例尺 0.1467 µm/px）导入 ImageJ，**Image → Type → 8-bit**。\n2. 用 Freehand 工具沿沟道边缘圈定 ROI，避开银线搭接处。\n3. Analyze → Measure 得到面积，三次圈定取平均。',
      params: [{ k: '比例尺', v: '0.1467 µm/px' }, { k: '对比度', v: 'Auto 后 +20%' }, { k: '阈值方法', v: 'Otsu' }],
      versions: [{ v: 1, at: `${day(-10)}T10:00:00+08:00`, since: '', note: '初版', params: [{ k: '比例尺', v: '0.1467 µm/px' }, { k: '对比度', v: 'Auto' }, { k: '阈值方法', v: 'Default' }] },
        { v: 2, at: `${day(-3)}T10:00:00+08:00`, since: x1, note: 'Default 阈值把银线算进沟道', params: [{ k: '比例尺', v: '0.1467 µm/px' }, { k: '对比度', v: 'Auto 后 +20%' }, { k: '阈值方法', v: 'Otsu' }] }],
      created: `${day(-10)}T10:00:00+08:00`, updated: `${day(-3)}T10:00:00+08:00` }, null, 1)}\n`,
    'methods/M-0002.json': `${JSON.stringify({ id: 'M-0002', vol: 'oect', papers: ['A1', 'A2'], title: '转移曲线统计：每组 n 与误差', cat: '统计分析', status: '已写入', tags: [], body: '每个条件至少 3 个器件；gm 取最大值；结果以 mean ± SD 表示，组间用 one-way ANOVA + Tukey。', params: [{ k: 'n', v: '≥ 3 devices' }, { k: '检验', v: 'one-way ANOVA, Tukey' }], versions: [{ v: 1, at: `${day(-8)}T10:00:00+08:00`, since: '', note: '初版', params: [{ k: 'n', v: '≥ 3 devices' }, { k: '检验', v: 'one-way ANOVA, Tukey' }] }], created: `${day(-8)}T10:00:00+08:00`, updated: `${day(-8)}T10:00:00+08:00` }, null, 1)}\n`,
    'clips/F-0001.json': `${JSON.stringify({ id: 'F-0001', kind: 'note', title: 'Nature 作图 template', cats: ['画图/template'], note: '框线 0.5 pt，坐标轴字号 7 pt\n单栏图宽 89 mm，双栏 183 mm', src: {}, created: `${day(-2)}T10:00:00+08:00`, updated: `${day(-2)}T10:00:00+08:00` }, null, 1)}\n`,
    'clips/F-0002.json': `${JSON.stringify({ id: 'F-0002', kind: 'img', title: '垂直 OECT 截面结构', cats: ['v-OECTs结构'], note: '', file: 'F-0002_v-OECTs结构_Rivnay2018_Fig._2a.png', src: { zotero: 'zotero://open-pdf/library/items/ABCD1234', page: '3', fig: 'Fig. 2a', cite: 'Rivnay et al. 2018', task: 'td5' }, created: `${day(-1)}T10:00:00+08:00`, updated: `${day(-1)}T10:00:00+08:00` }, null, 1)}\n`,
    'planner/tasks.json': `${JSON.stringify({
      tasks: [
        { id: 'td1', text: '双周报告', week: day(0), date: day(4), cat: '截止', done: false, created: `${day(-3)}T09:00:00+08:00` },
        { id: 'td2', text: '组会汇报 GOPS 稳定性', week: day(0), date: day(1), cat: '截止', done: false, created: `${day(-3)}T09:00:00+08:00` },
        { id: 'td3', text: 'Keithley 4200 14:00–17:00', week: day(0), date: day(0), cat: '仪器', done: false, created: `${day(-1)}T09:00:00+08:00` },
        { id: 'td4', text: '双光子打印机 9:00–12:00', week: day(0), date: day(2), cat: '仪器', done: false, created: `${day(-1)}T09:00:00+08:00` },
        { id: 'td5', text: 'Rivnay 2018 Nat. Rev. Mater. OECT 综述 10.1038/natrevmats.2017.86', week: day(0), cat: '文献', done: false, created: `${day(-2)}T09:00:00+08:00` },
        { id: 'td6', text: '报销 PEDOT:PSS 发票', week: day(0), date: day(3), cat: '杂事', done: false, created: `${day(-2)}T09:00:00+08:00` },
        { id: 'td7', text: '实验室安全培训', week: day(0), cat: '杂事', done: false, created: `${day(-2)}T09:00:00+08:00` },
        { id: 'td8', text: '跑步 5 km', week: day(0), date: day(0), cat: '生活', done: false, created: `${day(-1)}T09:00:00+08:00` },
      ],
      memos: [],
      finds: [
        { id: 'fd1', text: '银在盖玻片上可以打印，但碰到溶剂会溶解。可能是多孔、附着不好。', at: `${day(0)}T09:41:00+08:00` },
        { id: 'fd2', text: 'PEDOT:PSS 墨水放置 2 h 后粘度明显上升，出丝变细。', at: `${day(0)}T14:20:00+08:00` },
      ],
      projects: [
        { id: 'P1', title: '唾液 MMP-8 OECT 牙周炎早筛', kind: '课题', stage: '进行中', next: '完成 7 天稳定性', due: day(12), vols: ['oect'], why: 'MMP-8 是牙周炎活动期的标志物；现有床旁检测灵敏度不足。', priority: '高', every: 14, nextReview: day(0), reviews: [{ at: `${day(-14)}T09:00:00+08:00`, note: '读了 2 篇综述，抗体修饰栅极可行。' }] },
        { id: 'P3', title: '打印 PEDOT:PSS 器件的批间一致性', kind: '课题', stage: '想法', why: '为后续量产与临床样本测试打基础。', priority: '中', every: 30, nextReview: day(12), vols: [] },
        { id: 'P4', title: '可拉伸 OECT', kind: '课题', stage: '调研', why: '贴附皮肤的长期监测。', priority: '中', every: 0, vols: [] },
        { id: 'P2', title: '国自然青年基金', kind: '基金', stage: '申请中', next: '提交申请书初稿', due: day(9), vols: [] },
      ],
      papers: [
        { id: 'A1', title: 'Fully printed OECT for salivary biomarkers', journal: 'Adv. Mater.', stage: '写作中', due: day(20) },
        { id: 'A2', title: 'GOPS crosslinking and drift in PEDOT:PSS', journal: 'ACS AMI', stage: '返修', due: day(6) },
      ],
    }, null, 1)}\n`,
    'thinking/H-0001.json': `${JSON.stringify({ id: 'H-0001', title: '旋涂后气泡/气爆由氯仿快速挥发引起', status: '验证中', confidence: '中', observations: ['墨水中含少量氯仿（沸点 61 °C）时，旋涂膜加热到 60 °C 附近出现气泡，偶尔小气爆。', '不含氯仿的对照组气泡明显少。', '气泡集中出现在升温最快的前 2 min。'], rationale: '① 60 °C 接近氯仿沸点，膜内残留氯仿快速汽化、来不及扩散逸出而成泡（O1）。\n② 对照组无此溶剂，因此气泡少（O2）。\n③ 升温越快，汽化越集中，与 O3 一致。', predictions: ['去掉氯仿后不再出现气泡', '降低退火升温速率可减少气泡', '气泡数量随氯仿比例增加'], evidence: [{ id: 'E1', kind: '支持', pred: 'P1', date: day(-6), text: '加热到 60 °C 附近时瓶内出现大量气泡，瓶盖处有泄压声。', photos: [] }, { id: 'E2', kind: '待定', date: day(-4), text: '文献：氯仿沸点 61.2 °C，蒸气压 21 kPa（20 °C）。', src: { url: '10.1021/ja00000a000' }, photos: [] }, { id: 'E3', kind: '反对', date: day(-3), text: '不含氯仿的对照组在 140 °C 退火时也出现少量气泡。', src: { xid: x1, vol: 'oect', num: 1 }, photos: [] }], history: [{ at: `${day(-7)}T10:00:00+08:00`, status: '提出', confidence: '低', why: '提出' }, { at: `${day(-4)}T15:00:00+08:00`, status: '验证中', confidence: '中', why: '证据 1 与沸点吻合' }], created: `${day(-7)}T10:00:00+08:00`, updated: `${day(-3)}T10:00:00+08:00` }, null, 1)}\n`,
    'library/solutions.csv': `id,name,recipe,conc,volume,prepared,by,expires,location,page,status,notes\nS-0001,PEDOT:PSS 墨水（1 wt% GOPS）,R-0001 × 1 mL; R-0002 × 10 µL,1 wt% GOPS,1 mL,${d0},示例用户,${day(10)},4 °C 冰箱,${x1},在用,\n`,
    'library/protocols/SOP-DEMO-OECT-TR-v1.md': sop,
    'volumes/oect/pages/0001.md': page(
      `title: GOPS 浓度对沟道稳定性的影响\ndate: ${d0}\nid: ${x1}\nseries: PEDOT:PSS 配方优化\ntags: [oect, pedot-pss, gops]\nprotocol: SOP-DEMO-OECT-TR-v1\nreagents: [R-0001, R-0002, R-0003]\ndata: "01_Data/01_Keithley 4200/${d0.slice(0, 4)}/${x1}_GOPS"\nfollowups: ["✓ ${day(-2)} 稳定性复测（第 1 天）", "${day(0)} 稳定性复测（第 3 天）", "${day(4)} 稳定性复测（第 7 天）"]`,
      `## 目的\n\n比较 0.5、1、2 wt% GOPS 对 PBS 中 transfer 稳定性的影响。\n\n## 操作步骤\n\n\`\`\`steps\n移取 | 1 mL | PEDOT:PSS R-0001 | 5 mL 玻璃瓶 | 室温\n加入 | 10 µL | GOPS R-0002 | 上一步溶液 | | 用移液枪缓慢滴加，边加边摇\n超声 | | | | 10 min，冰浴 | 防止升温\n旋涂 | 60 µL | PEDOT:PSS 墨水 S-0001 | 玻璃片 | 1500 rpm，60 s\n退火 | | | 热台 | 140 °C，60 min\n\`\`\`\n\n## 反应式\n\n\`\`\`reaction\nPEDOT^+:PSS^- + M+ + e- -> PEDOT^0 + M+:PSS^- | (1)\n栅极：2 H2O2 ->[Pt] 2 H2O + O2 | (2)\nFe^3+ + e- <=> Fe^2+ | (3)\n\`\`\`\n\n将 10 mL DI 水加入烧杯，37 °C 下搅拌 30 min；所用 PBS 为 R-0003。{红|GOPS 加入后需在 2 h 内用完。}\n\n## 条件与结果\n\n\`\`\`samples\n编号,GOPS (wt%),退火 (°C),结果: gm_max (mS),结果: Vth (V),结果: on/off,备注\n#01,0.5,140,4.1,0.42,180,\n#09,1.0,140,3.6,0.45,240,边缘轻微翘起\n#10,2.0,140,2.2,0.51,95,\n\`\`\`\n\n## 与 SOP 的偏离\n\n- #10 浸泡 75 min（其余 60 min）。\n\n## 现象与讨论\n\nGOPS 增加后 gm 下降，但 #09 的漂移最小。沟道面积按 M-0001 测量。\n\n## 结论\n\n1 wt% GOPS 在 gm 与稳定性之间最平衡。\n\n## 下一步\n\n- 用 1 wt% GOPS 做 7 天稳定性测试\n- 测 #09 的输出曲线\n\n## 照片\n\n![#09 · 溶液 · 墨水呈深蓝色](${x1}-#09_solution.png)\n\n![#09 · 整片器件](${x1}-#09_device.png)`),
    [`volumes/oect/attachments/0001/${x1}-#09_solution.png`]: bytes(SOLUTION_PNG),
    [`volumes/oect/attachments/0001/${x1}-#09_device.png`]: bytes(DEVICE_PNG),
    'volumes/oect/pages/0003.md': page(
      `title: 第 2 轮：旋涂速度\ndate: ${d1}\nid: ${x3}\nseries: PEDOT:PSS 配方优化\ntags: [oect, pedot-pss]\nprotocol: SOP-DEMO-OECT-TR-v1\nreagents: [R-0001, R-0002, R-0003]`,
      `## 目的\n\n固定 GOPS 1 wt%，比较旋涂速度。{{1500 rpm}} 预计最好，++注意膜厚++，==旋涂后 5 min 内退火==。\n\n## 操作步骤\n\n\`\`\`quote\n${x1} #操作步骤\n本次完全按照此步骤操作，仅旋涂速度按样品号改变。\n\`\`\`\n\n## 条件与结果\n\n\`\`\`samples\n编号,GOPS (wt%),退火 (°C),旋涂 (rpm),结果: gm_max (mS),结果: Vth (V),结果: on/off,备注\n#01,1.0,140,1500,4.4,0.44,260,\n#02,1.0,140,3000,3.1,0.46,210,膜偏薄\n\`\`\`\n\n## 与 SOP 的偏离\n\n- \n\n## 现象与讨论\n\n1500 rpm 的 gm 最高。\n\n## 照片\n`),
    'volumes/oect/pages/0002.md': page(
      `title: 栅极面积对比\ndate: ${d1}\nid: ${x2}\ntags: [oect, gate]\nprotocol: SOP-DEMO-OECT-TR-v1\nreagents: [R-0003, R-0004]`,
      `## 目的\n\n\`\`\`hypothesis\nH-0001 P2\n退火升温速率由 10 °C/min 降到 2 °C/min，其余条件不变\n\`\`\`\n\n比较 Ø 3 mm 与 Ø 5 mm 碳栅极；升温方案按 [[H-0001#P2]]。\n\n## 条件与结果\n\n\`\`\`samples\n编号,栅极直径 (mm),结果: gm_max (mS),结果: Vth (V),备注\n#01,3,,,\n#02,5,,,\n\`\`\`\n\n## 与 SOP 的偏离\n\n- \n\n## 现象与讨论\n\n\n## 结论\n\n升温速率降到 2 °C/min 后气泡明显减少。\n\n## 照片\n`),
  };
}
