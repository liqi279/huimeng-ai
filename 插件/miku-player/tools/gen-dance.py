# -*- coding: utf-8 -*-
"""编排初音未来成套舞蹈：6 段 × 8 拍（约 112 BPM）。
   每段有明确的关键帧姿势、定格与重音，用余弦缓动插值。"""
import math, json, os

FPS = 30
BEAT = 60 / 112 * FPS          # 一拍 ≈ 16 帧
TOTAL_BEATS = 8

def interp(keys, frames):
    """keys: [(frame, value)] 关键帧；frames 总帧数；余弦缓动插值，段外保持端值"""
    keys = sorted(keys)
    out = []
    for f in range(frames):
        if f <= keys[0][0]: out.append(keys[0][1]); continue
        if f >= keys[-1][0]: out.append(keys[-1][1]); continue
        for i in range(len(keys) - 1):
            f0, v0 = keys[i]; f1, v1 = keys[i+1]
            if f0 <= f <= f1:
                t = 0 if f1 == f0 else (f - f0) / (f1 - f0)
                t = (1 - math.cos(t * math.pi)) / 2     # cosine ease-in-out
                out.append(v0 + (v1 - v0) * t)
                break
    return out

def beat(b): return int(round(b * BEAT))

def compose(frames, tracks):
    """tracks: {param: [(beat, val)] 或常数}"""
    lines = ['# Live2D Animator Motion Data', '$fps=%d' % FPS]
    default = dict(
        ANGLE_X=0, ANGLE_Y=0, ANGLE_Z=0,
        EYE_L_OPEN=1, EYE_R_OPEN=1, EYE_L_SMILE=0, EYE_R_SMILE=0,
        EYE_BALL_X=0, EYE_BALL_Y=0,
        BROW_L_Y=0.2, BROW_R_Y=0.2, BROW_L_X=0, BROW_R_X=0,
        BROW_L_ANGLE=0.3, BROW_R_ANGLE=0.3, BROW_L_FORM=0, BROW_R_FORM=0,
        MOUTH_FORM=0.3, MOUTH_OPEN_Y=0, CHEEK=0,
        BODY_ANGLE_X=0, BODY_ANGLE_Y=0, BODY_ANGLE_Z=0,
        ARM_L=0, ARM_R=0, BREATH=0,
        HAIR_FRONT=0, HAIR_SIDE=0, HAIR_BACK=0, HAIR_BACK_L=0, HAIR_BACK_R=0)
    for p, base in default.items():
        t = tracks.get(p, base)
        if isinstance(t, list):
            vals = interp([(beat(b), v) for b, v in t], frames)
            lines.append('PARAM_%s=%s' % (p, ','.join('%.2f' % v for v in vals)))
        else:
            lines.append('PARAM_%s=%g' % (p, t))
    return '\n'.join(lines) + '\n'

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'build', 'dance')
os.makedirs(OUT_DIR, exist_ok=True)
F = int(round(TOTAL_BEATS * BEAT))     # 每段 8 拍

# ---------- ① 起手亮相：低头鞠躬 → 抬头，右臂高举定格 ----------
d1 = compose(F, {
    'ANGLE_X':   [(0,0),(1,-4),(2,0),(3.5,0),(4,10),(5,12),(6,0),(8,0)],
    'ANGLE_Y':   [(0,0),(1,10),(2,12),(3,10),(4,-6),(5,-4),(6,0),(8,0)],
    'BODY_ANGLE_X': [(0,0),(1,6),(2,8),(3,6),(4,-4),(5,-3),(6,0),(8,0)],
    'ARM_R':     [(0,0),(1,0),(2,0),(3,0),(3.5,0.85),(4,1),(5,1),(5.5,0.7),(6,0),(8,0)],
    'ARM_L':     [(0,0),(2,-0.3),(3,0),(8,0)],
    'EYE_BALL_Y':[(0,0),(1,0.5),(3,0.5),(4,-0.3),(5.5,-0.3),(6,0),(8,0)],
    'EYE_L_SMILE': [(0,0),(5,0),(5.5,0.8),(7,0.8),(8,0)],
    'EYE_R_SMILE': [(0,0),(5,0),(5.5,0.8),(7,0.8),(8,0)],
    'MOUTH_FORM': [(0,0.3),(5,0.3),(5.5,1),(8,1)],
    'CHEEK': [(0,0),(4,0),(5,0.5),(8,0.5)],
    'EYE_L_OPEN': [(0,1),(1,0.1),(1.4,0.1),(2,1),(8,1)],     # 鞠躬时闭眼
    'EYE_R_OPEN': [(0,1),(1,0.1),(1.4,0.1),(2,1),(8,1)],
})

# ---------- ② 左右律动 groove：重心左右移，双臂小幅反相随摆 ----------
swing = [(b, (1 if i % 2 == 0 else -1)) for i, b in enumerate(range(0, 9, 1))]
d2 = compose(F, {
    'BODY_ANGLE_X': [(b, (10 if i % 2 == 0 else -10)) for i, b in enumerate(range(0, 9, 1))],
    'ANGLE_Z':      [(b, (6 if i % 2 == 0 else -6)) for i, b in enumerate(range(0, 9, 1))],
    'ANGLE_X':      [(b, (5 if i % 2 == 0 else -5)) for i, b in enumerate(range(0, 9, 1))],
    'ARM_L': [(0,0),(1,-0.4),(2,0.5),(3,-0.4),(4,0.5),(5,-0.4),(6,0.5),(7,-0.4),(8,0)],
    'ARM_R': [(0,0),(1,0.5),(2,-0.4),(3,0.5),(4,-0.4),(5,0.5),(6,-0.4),(7,0.5),(8,0)],
    'EYE_BALL_X': [(0,0),(1,0.6),(2,-0.6),(3,0.6),(4,-0.6),(5,0.6),(6,-0.6),(7,0.5),(8,0)],
    'EYE_BALL_Y': 0.2,
    'MOUTH_FORM': 0.7,
    'CHEEK': 0.4,
})

# ---------- ③ 双臂大摆：8 拍内左右臂交替高举过头 ----------
d3 = compose(F, {
    'ARM_L': [(0,0),(0.5,0.9),(1.5,0.9),(2,-0.2),(2.5,-0.2),(3,1),(4.5,1),(5,0.2),(6,0.2),(6.5,0.9),(7.5,0.9),(8,0)],
    'ARM_R': [(0,0),(0.5,-0.2),(1.5,-0.2),(2,1),(3,1),(3.5,-0.2),(5,-0.2),(5.5,0.95),(7,0.95),(8,0)],
    'ANGLE_X': [(0,0),(1,-12),(2,10),(3,-12),(4,10),(5,-12),(6,10),(7,-10),(8,0)],
    'ANGLE_Z': [(0,0),(1,8),(2,-8),(3,8),(4,-8),(5,8),(6,-8),(7,6),(8,0)],
    'BODY_ANGLE_Z': [(0,0),(1,5),(2,-5),(3,5),(4,-5),(5,5),(6,-5),(7,3),(8,0)],
    'EYE_BALL_Y': [(0,0),(1,0.7),(3,0.7),(4,-0.2),(6,-0.2),(7,0),(8,0)],
    'CHEEK': 0.5,
    'MOUTH_FORM': 1,
})

# ---------- ④ 转体扭腰：身体 Z 轴连续旋转，头滞后反相 ----------
d4 = compose(F, {
    'BODY_ANGLE_Z': [(0,0),(1,10),(2,-10),(3,10),(4,-10),(5,10),(6,-10),(7,8),(8,0)],
    'BODY_ANGLE_Y': [(0,0),(2,0),(3,6),(4.5,0),(5,-6),(6.5,0),(8,0)],
    'ANGLE_X': [(0,0),(1.5,0),(2,14),(3,-14),(4,14),(5,-14),(6,12),(7,0),(8,0)],
    'ANGLE_Z': [(0,0),(1,-10),(2,10),(3,-10),(4,10),(5,-10),(6,8),(7,0),(8,0)],
    'ARM_L': [(0,0),(1,0.6),(2,-0.3),(3,0.6),(4,-0.3),(5,0.6),(6,-0.3),(8,0)],
    'ARM_R': [(0,0),(1,-0.3),(2,0.6),(3,-0.3),(4,0.6),(5,-0.3),(6,0.6),(8,0)],
    'EYE_BALL_X': [(0,0),(1,0.8),(2,-0.8),(3,0.8),(4,-0.8),(5,0.8),(6,-0.8),(8,0)],
    'CHEEK': 0.6,
    'MOUTH_FORM': 0.8,
})

# ---------- ⑤ 应援挥手：双臂高举交替挥动（粉丝应援），笑眼 ----------
d5 = compose(F, {
    'ARM_L': [(0,0),(1,1),(1.5,0.7),(2,1),(2.5,0.7),(3,1),(3.5,0.7),(4,1),(4.5,0.3),(5,0),(6,0),(8,0)],
    'ARM_R': [(0,0),(1,0),(2,0),(3,0),(4,0.3),(4.5,1),(5,0.7),(5.5,1),(6,0.7),(6.5,1),(7,0.7),(7.5,1),(8,0.6)],
    'ANGLE_Y': [(0,0),(1,4),(2,0),(3,4),(4,0),(5,-4),(6,0),(7,-3),(8,0)],
    'ANGLE_X': [(0,0),(1,6),(2,0),(3,6),(4,0),(5,-6),(6,0),(8,0)],
    'EYE_L_SMILE': [(0,0),(1,0.9),(5,0.9),(5.5,0),(8,0)],
    'EYE_R_SMILE': [(0,0),(1,0.9),(5,0.9),(5.5,0),(8,0)],
    'EYE_BALL_X': [(0,0),(2,0),(2.5,0.7),(4,0.7),(4.5,-0.7),(6,-0.7),(8,0)],
    'MOUTH_FORM': 1,
    'CHEEK': 0.7,
    'BREATH': [(0,0),(4,1),(8,0)],
})

# ---------- ⑥ 收势定格：所有幅度收敛，最后回到微笑定姿 ----------
d6 = compose(F, {
    'ANGLE_X': [(0,0),(1,8),(2,-6),(3,4),(4,0),(8,0)],
    'ANGLE_Z': [(0,0),(1,-5),(2,4),(3,-2),(4,0),(8,0)],
    'BODY_ANGLE_X': [(0,0),(1,4),(2,-3),(3,2),(4,0),(8,0)],
    'ARM_L': [(0,0),(1,0.5),(2,0.3),(3,0.1),(4,0),(8,0)],
    'ARM_R': [(0,0),(1,0.8),(2,0.5),(3,0.2),(3.5,0.55),(4,0.5),(5,0.5),(6,0),(8,0)],
    'EYE_L_SMILE': [(0,0),(4,0),(4.5,1),(8,1)],
    'EYE_R_SMILE': [(0,0),(4,0),(4.5,1),(8,1)],
    'MOUTH_FORM': [(0,0.3),(4,0.3),(4.5,1),(8,1)],
    'CHEEK': [(0,0.3),(4,0.3),(4.5,0.8),(8,0.8)],
    'EYE_BALL_Y': [(0,0),(3,0),(3.5,0.4),(8,0.4)],
    'BREATH': [(0,0),(8,1)],
})

dances = {'dance_01': d1, 'dance_02': d2, 'dance_03': d3,
          'dance_04': d4, 'dance_05': d5, 'dance_06': d6}
for name, data in dances.items():
    p = os.path.join(OUT_DIR, '%s.mtn' % name)
    open(p, 'w', newline='\n').write(data)
    print(name, os.path.getsize(p), 'B', '| 帧数', data.count(',')+1 if False else len(data.split('\n')[3].split('='))-1 and 'ok')

# 生成后还需验证：用真实 Cubism2 Core 试解析
print('生成完毕')
