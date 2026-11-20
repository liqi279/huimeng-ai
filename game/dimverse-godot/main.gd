extends Node2D
## Two-stage Dimverse mini game. Transparent Godot Web overlay; website owns the backdrop.
enum Phase { WAITING, INTRO, MASCOT_FALL, SIGNBOARD, PLAYING, CELEBRATE, BLOCK, MAZE_TRANSITION, MAZE, GAME_OVER }
enum IntroState { WAITING, TITLE_PARTICLES, MASCOT_FORM, MASCOT_BLINK, MASCOT_FALL, PLAYING }
const W := 1280.0
const H := 720.0
const CYAN := Color("#67eaff")
const PINK := Color("#f18bce")
const PURPLE := Color("#a78bfa")
const CELL := 36.0
var phase: Phase = Phase.WAITING
var intro_state: IntroState = IntroState.WAITING
var particles: Array[Dictionary] = []
var rng := RandomNumberGenerator.new()
var t := 0.0
var phase_t := 0.0
var player := Vector2(640, 500)
var velocity := Vector2.ZERO
var score := 0
var remaining := 60.0
var crystals: Array[Vector2] = []
var crystal_spawn_clock := 0.0
var confetti: Array[Dictionary] = []
var block_particles: Array[Dictionary] = []
var block_pos := Vector2(640, 275)
var block_hit := false
var maze: Array = []
var maze_w := 25
var maze_h := 15
var cell_size := 36.0
var ghost_positions: Array[Vector2] = []
var ghost_paths: Array[Vector2] = []
var game_over_sent := false
var maze_escaped := false
var last_size := Vector2(1280, 720)
var mascot_scale := 1.0
var blink_until := 0.0
var next_blink := 2.5

func _ready() -> void:
    rng.randomize()
    _register_bridge()
    set_process(false)
    queue_redraw()
    call_deferred("_start")

func _register_bridge() -> void:
    if not OS.has_feature("web"): return
    var browser_window = JavaScriptBridge.get_interface("window")
    if browser_window:
        browser_window.set("hmGodotStart", JavaScriptBridge.create_callback(_on_start_from_web))
    JavaScriptBridge.eval("window.parent.postMessage('hm-godot-ready','*');")

func _on_start_from_web(_args = []) -> void:
    _start()

func _start() -> void:
    if phase != Phase.WAITING: return
    phase = Phase.INTRO
    intro_state = IntroState.TITLE_PARTICLES
    phase_t = 0.0
    _build_mascot_particles()
    set_process(true)

func _build_mascot_particles() -> void:
    particles.clear()
    for y in range(-43, 44, 4):
        for x in range(-62, 63, 4):
            var shape := (float(x * x) / (62.0 * 62.0)) + (float(y * y) / (43.0 * 43.0))
            if shape > 1.0 or rng.randf() > 0.78: continue
            if absf(y + 8.0) < 8.0 and (absf(x - 16.0) < 5.0 or absf(x + 16.0) < 5.0): continue
            var target := Vector2(640.0 + x, 205.0 + y)
            var start := Vector2(rng.randf_range(350.0, 930.0), rng.randf_range(335.0, 405.0))
            particles.append({"start": start, "position": start, "target": target, "delay": rng.randf_range(0.0, 0.55), "size": rng.randf_range(1.0, 2.8), "color": CYAN.lerp(PINK, rng.randf())})

func _update_intro_particles() -> void:
    for particle in particles:
        var target: Vector2 = particle["target"]
        if intro_state == IntroState.MASCOT_FORM:
            particle["position"] = target + Vector2(sin(phase_t * 7.0 + target.x * 0.04) * 1.2, cos(phase_t * 5.0 + target.y * 0.03) * 0.8)
        else:
            var progress := clampf((phase_t - float(particle["delay"])) / 1.2, 0.0, 1.0)
            var eased := 1.0 - pow(1.0 - progress, 3.0)
            var start: Vector2 = particle["start"]
            particle["position"] = start.lerp(target, eased)

func _notify_landed() -> void:
    if OS.has_feature("web"):
        JavaScriptBridge.eval("window.parent.postMessage('hm-godot-landed','*');")

func _process(delta: float) -> void:
    var dt := minf(delta, 0.04)
    t += dt
    phase_t += dt
    match phase:
        Phase.INTRO:
            _update_intro_particles()
            if intro_state == IntroState.TITLE_PARTICLES and phase_t >= 1.8:
                intro_state = IntroState.MASCOT_FORM
                phase_t = 0.0
            elif intro_state == IntroState.MASCOT_FORM and phase_t >= 0.7:
                intro_state = IntroState.MASCOT_BLINK
                phase_t = 0.0
                player = Vector2(640.0, 205.0)
            elif intro_state == IntroState.MASCOT_BLINK and phase_t >= 0.2:
                intro_state = IntroState.MASCOT_FALL
                phase = Phase.MASCOT_FALL
                phase_t = 0.0
                player = Vector2(640.0, -75.0)
                velocity = Vector2(0.0, 80.0)
        Phase.MASCOT_FALL:
            velocity.y += 1450.0 * dt
            player += velocity * dt
            if player.y >= H * 0.68:
                player.y = H * 0.68
                velocity = Vector2.ZERO
                phase = Phase.SIGNBOARD
                phase_t = 0.0
                intro_state = IntroState.PLAYING
                _notify_landed()
        Phase.SIGNBOARD:
            if phase_t >= 1.25:
                phase = Phase.PLAYING
                phase_t = 0.0
                player = Vector2(W * 0.5, H * 0.68)
                crystal_spawn_clock = 0.0
                for i in range(8): _spawn_crystal()
        Phase.PLAYING:
            _update_player(dt, false)
            remaining = maxf(0.0, remaining - dt)
            _update_crystals(dt)
            if phase == Phase.PLAYING and remaining <= 0.0:
                phase = Phase.GAME_OVER
                phase_t = 0.0
                maze_escaped = false
                game_over_sent = false
        Phase.CELEBRATE:
            _update_confetti(dt)
            if phase_t >= 2.6:
                confetti.clear()
                phase = Phase.BLOCK
                phase_t = 0.0
                block_hit = false
                player = Vector2(block_pos.x, H - 90.0)
                velocity = Vector2.ZERO
                if OS.has_feature("web"):
                    JavaScriptBridge.eval("window.parent.postMessage('hm-godot-block','*');")
        Phase.BLOCK:
            _update_block_player(dt)
            if block_hit:
                _build_maze()
                phase = Phase.MAZE_TRANSITION
                phase_t = 0.0
                player = _cell_center(Vector2i(1, 1))
                mascot_scale = 0.22
                if OS.has_feature("web"):
                    JavaScriptBridge.eval("window.parent.postMessage('hm-godot-maze','*');")
        Phase.MAZE_TRANSITION:
            _update_block_particles(dt)
            if phase_t >= 0.9:
                phase = Phase.MAZE
                phase_t = 0.0
        Phase.MAZE:
            _update_maze_player(dt)
            if phase == Phase.MAZE:
                _update_ghosts(dt)
                for ghost in ghost_positions:
                    if player.distance_to(ghost) < cell_size * 0.62:
                        phase = Phase.GAME_OVER
                        phase_t = 0.0
                        maze_escaped = false
                        game_over_sent = false
                        break
        Phase.GAME_OVER:
            if phase_t >= 2.7 and not game_over_sent:
                game_over_sent = true
                if OS.has_feature("web"):
                    JavaScriptBridge.eval("window.parent.postMessage('hm-godot-welcome','*');")
                set_process(false)
    _update_blink(dt)
    queue_redraw()

func _update_blink(dt: float) -> void:
    if t >= next_blink:
        blink_until = t + 0.14
        next_blink = t + rng.randf_range(2.0, 4.0)

func _move_input() -> Vector2:
    var x := Input.get_axis("ui_left", "ui_right")
    var y := Input.get_axis("ui_up", "ui_down")
    if Input.is_key_pressed(KEY_A): x -= 1.0
    if Input.is_key_pressed(KEY_D): x += 1.0
    if Input.is_key_pressed(KEY_W): y -= 1.0
    if Input.is_key_pressed(KEY_S): y += 1.0
    return Vector2(x, y).normalized()

func _update_player(dt: float, maze_mode: bool) -> void:
    var direction := _move_input()
    var target := direction * (190.0 if maze_mode else 330.0)
    velocity = velocity.move_toward(target, (1150.0 if direction.length_squared() > 0.0 else 1500.0) * dt)
    player += velocity * dt
    player.x = clampf(player.x, 72.0, W - 72.0)
    player.y = clampf(player.y, 130.0, H - 70.0)

func _spawn_crystal() -> void:
    for attempt in range(60):
        var p := Vector2(rng.randf_range(42.0, W - 42.0), rng.randf_range(86.0, H - 40.0))
        var clear := true
        for other in crystals:
            if p.distance_to(other) < 100.0: clear = false
        if clear:
            crystals.append(p)
            return

func _update_crystals(dt: float) -> void:
    crystal_spawn_clock += dt
    if crystals.size() < 15 and crystal_spawn_clock >= 0.42:
        crystal_spawn_clock = 0.0
        _spawn_crystal()
    for i in range(crystals.size() - 1, -1, -1):
        if player.distance_to(crystals[i]) < 58.0:
            crystals.remove_at(i)
            score += 1
            if score > 20:
                phase = Phase.CELEBRATE
                phase_t = 0.0
                _make_confetti()
                return


func _make_block_burst() -> void:
    block_particles.clear()
    for i in range(180):
        var angle := rng.randf_range(0.0, TAU)
        var speed := rng.randf_range(100.0, 560.0)
        block_particles.append({
            "p": block_pos + Vector2(rng.randf_range(-36.0, 36.0), rng.randf_range(-36.0, 36.0)),
            "v": Vector2(cos(angle), sin(angle)) * speed,
            "age": 0.0, "life": rng.randf_range(0.55, 1.2),
            "size": rng.randf_range(2.0, 6.0),
            "c": [Color("#fff0a6"), Color("#ffc34e"), CYAN, PURPLE][i % 4]
        })

func _update_block_particles(dt: float) -> void:
    for item in block_particles:
        item.p += item.v * dt
        item.v.y += 280.0 * dt
        item.age += dt

func _draw_block_particles() -> void:
    for item in block_particles:
        var alpha := 1.0 - float(item.age) / float(item.life)
        if alpha <= 0.0: continue
        var tint: Color = item.c
        tint.a = alpha
        draw_rect(Rect2(item.p, Vector2.ONE * float(item.size)), tint, true)

func _make_confetti() -> void:
    for i in range(150):
        confetti.append({"p": Vector2(rng.randf_range(0, W), rng.randf_range(-H, 0)), "v": Vector2(rng.randf_range(-90, 90), rng.randf_range(120, 390)), "r": rng.randf_range(2, 5), "c": [CYAN, PINK, PURPLE, Color("#f8d477")][rng.randi_range(0, 3)]})

func _make_confetti_burst(at: Vector2) -> void:
    for i in range(18):
        var a := rng.randf_range(0.0, TAU)
        confetti.append({"p": at, "v": Vector2(cos(a), sin(a)) * rng.randf_range(90, 260), "r": rng.randf_range(2, 4), "c": [CYAN, PINK, PURPLE, Color.WHITE][rng.randi_range(0, 3)]})

func _update_confetti(dt: float) -> void:
    for item in confetti:
        item.p += item.v * dt
        item.v.y += 180.0 * dt
    for i in range(confetti.size() - 1, -1, -1):
        if confetti[i].p.y > H + 30: confetti.remove_at(i)

func _update_block_player(dt: float) -> void:
    var direction := _move_input()
    velocity.x = move_toward(velocity.x, direction.x * 280.0, 1500.0 * dt)
    if Input.is_action_just_pressed("ui_up") or Input.is_key_pressed(KEY_W):
        if player.y > block_pos.y + 58.0 and absf(player.x - block_pos.x) < 92.0 and velocity.y >= -10.0:
            velocity.y = -1050.0
    velocity.y += 1550.0 * dt
    player += velocity * dt
    player.x = clampf(player.x, 70.0, W - 70.0)
    if player.y < block_pos.y + 58.0 and player.y > block_pos.y - 8.0 and absf(player.x - block_pos.x) < 72.0 and velocity.y < 0.0:
        block_hit = true
        _make_block_burst()
    if player.y > H - 78.0:
        player.y = H - 78.0
        velocity.y = 0.0

func _build_maze() -> void:
    maze_w = clampi(int(W / CELL), 21, 31)
    maze_h = clampi(int(H / CELL), 13, 19)
    if maze_w % 2 == 0: maze_w -= 1
    if maze_h % 2 == 0: maze_h -= 1
    cell_size = minf(W / maze_w, H / maze_h)
    maze.clear()
    for y in range(maze_h):
        var row: Array[int] = []
        for x in range(maze_w): row.append(1)
        maze.append(row)
    var stack: Array[Vector2i] = [Vector2i(1, 1)]
    maze[1][1] = 0
    while not stack.is_empty():
        var current: Vector2i = stack.back()
        var choices: Array[Vector2i] = []
        for d in [Vector2i(0, -2), Vector2i(2, 0), Vector2i(0, 2), Vector2i(-2, 0)]:
            var n: Vector2i = current + d
            if n.x > 0 and n.y > 0 and n.x < maze_w - 1 and n.y < maze_h - 1 and maze[n.y][n.x] == 1:
                choices.append(n)
        if choices.is_empty():
            stack.pop_back()
        else:
            var next: Vector2i = choices[rng.randi_range(0, choices.size() - 1)]
            maze[(current.y + next.y) / 2][(current.x + next.x) / 2] = 0
            maze[next.y][next.x] = 0
            stack.append(next)
    maze[maze_h - 2][maze_w - 2] = 0
    # Ensure a readable exit corridor.
    maze[maze_h - 2][maze_w - 3] = 0
    ghost_positions = [_cell_center(Vector2i(maze_w - 2, 1)), _cell_center(Vector2i(1, maze_h - 2))]
    ghost_paths = [Vector2.ZERO, Vector2.ZERO]
    mascot_scale = 0.22

func _cell_center(c: Vector2i) -> Vector2:
    var ox := (W - maze_w * cell_size) * 0.5
    var oy := (H - maze_h * cell_size) * 0.5
    return Vector2(ox + (c.x + 0.5) * cell_size, oy + (c.y + 0.5) * cell_size)

func _is_open(p: Vector2) -> bool:
    var ox := (W - maze_w * cell_size) * 0.5
    var oy := (H - maze_h * cell_size) * 0.5
    var radius := cell_size * 0.34
    for offset in [Vector2(-radius, -radius), Vector2(radius, -radius), Vector2(-radius, radius), Vector2(radius, radius)]:
        var c := Vector2i(floori((p.x + offset.x - ox) / cell_size), floori((p.y + offset.y - oy) / cell_size))
        if c.x < 0 or c.y < 0 or c.x >= maze_w or c.y >= maze_h or maze[c.y][c.x] != 0:
            return false
    return true

func _update_maze_player(dt: float) -> void:
    var direction := _move_input()
    var target := direction * 175.0
    velocity = velocity.move_toward(target, 1100.0 * dt)
    var next_x := Vector2(player.x + velocity.x * dt, player.y)
    var next_y := Vector2(player.x, player.y + velocity.y * dt)
    if _is_open(next_x): player.x = next_x.x
    else: velocity.x = 0.0
    if _is_open(next_y): player.y = next_y.y
    else: velocity.y = 0.0
    if player.distance_to(_cell_center(Vector2i(maze_w - 2, maze_h - 2))) < cell_size * 0.5:
        phase = Phase.GAME_OVER
        phase_t = 0.0
        maze_escaped = true
        game_over_sent = false

func _cell_at(p: Vector2) -> Vector2i:
    var ox := (W - maze_w * cell_size) * 0.5
    var oy := (H - maze_h * cell_size) * 0.5
    return Vector2i(floori((p.x - ox) / cell_size), floori((p.y - oy) / cell_size))

func _next_path_cell(start: Vector2i, goal: Vector2i) -> Vector2i:
    var queue: Array[Vector2i] = [start]
    var came_from: Dictionary = {start: start}
    var found := false
    var cursor := 0
    while cursor < queue.size():
        var current: Vector2i = queue[cursor]
        cursor += 1
        if current == goal:
            found = true
            break
        var directions: Array[Vector2i] = [Vector2i(0, -1), Vector2i(1, 0), Vector2i(0, 1), Vector2i(-1, 0)]
        for direction: Vector2i in directions:
            var neighbor: Vector2i = current + direction
            if neighbor.x < 0 or neighbor.y < 0 or neighbor.x >= maze_w or neighbor.y >= maze_h: continue
            if maze[neighbor.y][neighbor.x] != 0 or came_from.has(neighbor): continue
            came_from[neighbor] = current
            queue.append(neighbor)
    if not found: return start
    var step := goal
    while came_from.get(step, start) != start and step != start:
        step = came_from[step]
    if step == start and goal != start:
        step = goal
    return step

func _update_ghosts(dt: float) -> void:
    for i in range(ghost_positions.size()):
        var g: Vector2 = ghost_positions[i]
        var from_cell := _cell_at(g)
        var to_cell := _cell_at(player)
        var waypoint := _cell_center(_next_path_cell(from_cell, to_cell))
        var speed := 82.0 + float(i) * 14.0
        ghost_positions[i] = g.move_toward(waypoint, speed * dt)

func _draw() -> void:
    # Deliberately no world/background/grid drawing: the original webpage remains the visual world.
    if phase == Phase.WAITING: return
    if phase == Phase.INTRO:
        _draw_intro_particles()
        if intro_state in [IntroState.MASCOT_BLINK, IntroState.MASCOT_FALL]:
            _draw_player()
        return
    if phase in [Phase.MASCOT_FALL, Phase.SIGNBOARD, Phase.PLAYING, Phase.CELEBRATE, Phase.BLOCK]:
        _draw_stage_one()
    elif phase in [Phase.MAZE_TRANSITION, Phase.MAZE]:
        _draw_maze()
        if phase == Phase.MAZE_TRANSITION: _draw_block_particles()
    elif phase == Phase.GAME_OVER:
        _draw_game_over()
    if phase == Phase.CELEBRATE:
        _draw_confetti()
    if phase == Phase.BLOCK:
        _draw_block()
    _draw_player()

func _draw_intro_particles() -> void:
    for particle in particles:
        var pos: Vector2 = particle["position"]
        var color: Color = particle["color"]
        var size := float(particle["size"])
        draw_circle(pos, size * 3.2, Color(color.r, color.g, color.b, 0.16))
        draw_circle(pos, size, color)

func _draw_stage_one() -> void:
    if phase in [Phase.MASCOT_FALL, Phase.SIGNBOARD]:
        if phase == Phase.SIGNBOARD:
            var drop := minf(1.0, phase_t / 0.8)
            var eased := 1.0 - pow(1.0 - drop, 3.0)
            var intro_sign_y := lerpf(-105.0, H * 0.47 - 32.0, eased)
            _draw_sign(intro_sign_y)
        return
    # Slim center signboard descends, then the 60-second clock begins.
    if phase == Phase.PLAYING:
        var compact := minf(1.0, phase_t / 0.7)
        var sign_y := lerpf(H * 0.47 - 32.0, 72.0, 1.0 - pow(1.0 - compact, 3.0))
        _draw_sign(sign_y)
        _draw_hud()
        for c in crystals: _draw_crystal(c)
    elif phase == Phase.CELEBRATE:
        _draw_sign(72.0)
        _draw_hud()
        if score > 20:
            _draw_center_text("超能量收集！", "CRYSTAL FEVER  ·  %02d 枚" % score)
        else:
            _draw_center_text("挑战时间结束", "本次收集 %02d 枚  ·  方块即将出现" % score)
    elif phase == Phase.BLOCK:
        _draw_hud()
        _draw_center_text("向上撞击能量方块", "站到方块正下方，按 W / ↑ 跳起")

func _draw_sign(y: float) -> void:
    var rect := Rect2(W * 0.5 - 180.0, y, 360.0, 64.0)
    draw_rect(rect.grow(7), Color(0.0, 0.0, 0.0, 0.18), true)
    draw_rect(rect, Color("#0a1730"), true)
    draw_rect(rect, CYAN, false, 1.5)
    draw_string(ThemeDB.fallback_font, Vector2(rect.position.x + 24, y + 26), "DIMENSIONAL CHALLENGE", HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color("#9ab8d2"))
    draw_string(ThemeDB.fallback_font, Vector2(rect.position.x + 24, y + 49), "晶体吞食挑战  /  60 SEC", HORIZONTAL_ALIGNMENT_LEFT, -1, 19, Color("#eafaff"))

func _draw_hud() -> void:
    # Collection counter and countdown sit together as one compact HUD group.
    var panel := Rect2(24, 78, 220, 70)
    draw_rect(panel, Color(0.015, 0.035, 0.09, 0.78), true)
    draw_rect(panel, Color(0.2, 0.82, 0.98, 0.48), false, 1.0)
    draw_string(ThemeDB.fallback_font, Vector2(42, 104), "CRYSTALS  /  吞食数量", HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color("#9cb8d1"))
    draw_string(ThemeDB.fallback_font, Vector2(42, 134), "%02d" % score, HORIZONTAL_ALIGNMENT_LEFT, -1, 27, Color("#7cecff"))
    var timer_panel := Rect2(258, 78, 156, 70)
    draw_rect(timer_panel, Color(0.035, 0.02, 0.09, 0.78), true)
    draw_rect(timer_panel, Color(0.68, 0.48, 0.98, 0.48), false, 1.0)
    draw_string(ThemeDB.fallback_font, Vector2(274, 104), "TIME LEFT", HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color("#b9a7df"))
    var seconds := ceili(remaining)
    draw_string(ThemeDB.fallback_font, Vector2(274, 134), "%02d:%02d" % [seconds / 60, seconds % 60], HORIZONTAL_ALIGNMENT_LEFT, -1, 27, Color("#f1e9ff"))

func _draw_crystal(p: Vector2) -> void:
    var pulse := 1.0 + 0.15 * sin(t * 4.0 + p.x)
    draw_circle(p, 22.0 * pulse, Color(0.1, 0.85, 1.0, 0.12))
    var poly := PackedVector2Array([p + Vector2(0, -13), p + Vector2(11, 0), p + Vector2(0, 13), p + Vector2(-11, 0)])
    draw_colored_polygon(poly, CYAN)
    draw_polyline(PackedVector2Array([poly[0], poly[1], poly[2], poly[3], poly[0]]), Color.WHITE, 1.0, true)

func _draw_block() -> void:
    var r := Rect2(block_pos - Vector2(42, 42), Vector2(84, 84))
    draw_rect(r.grow(12), Color(1.0, 0.72, 0.18, 0.1), true)
    draw_rect(r, Color("#f6b83f"), true)
    draw_rect(r, Color("#fff0a6"), false, 4.0)
    draw_rect(r.grow(-10), Color("#d77a23"), false, 2.0)
    draw_string(ThemeDB.fallback_font, block_pos + Vector2(-12, 12), "?", HORIZONTAL_ALIGNMENT_LEFT, -1, 48, Color("#fff8db"))

func _draw_maze() -> void:
    var ox := (W - maze_w * cell_size) * 0.5
    var oy := (H - maze_h * cell_size) * 0.5
    draw_rect(Rect2(0, 0, W, H), Color(0.015, 0.02, 0.07, 0.96), true)
    for y in range(maze_h):
        for x in range(maze_w):
            var r := Rect2(ox + x * cell_size, oy + y * cell_size, cell_size, cell_size)
            if maze[y][x] == 1:
                draw_rect(r, Color("#182343"), true)
                draw_rect(r, Color(0.18, 0.72, 0.95, 0.24), false, 1.0)
            else:
                draw_rect(r, Color("#091127"), true)
    var exit := _cell_center(Vector2i(maze_w - 2, maze_h - 2))
    draw_circle(exit, cell_size * 0.8, Color(0.56, 0.25, 1.0, 0.12))
    for k in range(3):
        draw_arc(exit, cell_size * (0.25 + k * 0.19), t * 1.2 + k, TAU + t * 1.2 + k, 64, PURPLE, 2.0, true)
    draw_string(ThemeDB.fallback_font, Vector2(24, 44), "MAZE SECTOR  /  找到漩涡出口", HORIZONTAL_ALIGNMENT_LEFT, -1, 17, Color("#d9d5ff"))
    for g in ghost_positions: _draw_ghost(g)

func _draw_ghost(p: Vector2) -> void:
    var bob := sin(t * 5.0 + p.x) * 2.5
    draw_circle(p, cell_size * 0.48, Color(0.95, 0.38, 0.62, 0.12))
    var body := Rect2(p + Vector2(-10, -7 + bob), Vector2(20, 19))
    draw_rect(body, Color("#f18bce"), true)
    draw_circle(p + Vector2(0, -7 + bob), 10, Color("#f18bce"))
    draw_circle(p + Vector2(-3, -8 + bob), 2, Color("#27213d"))
    draw_circle(p + Vector2(4, -8 + bob), 2, Color("#27213d"))
    draw_colored_polygon(PackedVector2Array([p + Vector2(-10, 11 + bob), p + Vector2(-5, 7 + bob), p + Vector2(0, 11 + bob), p + Vector2(5, 7 + bob), p + Vector2(10, 11 + bob)]), Color("#f18bce"))

func _draw_game_over() -> void:
    draw_rect(Rect2(0, 0, W, H), Color(0.015, 0.01, 0.06, 0.94), true)
    var center := Vector2(W * 0.5, H * 0.5)
    var radius := lerpf(20.0, 900.0, minf(1.0, phase_t / 2.4))
    for i in range(5):
        draw_arc(center, radius * (0.42 + i * 0.14), t * 1.7 + i, TAU + t * 1.7 + i, 96, [CYAN, PURPLE, PINK][i % 3], 7.0 - i * 0.7, true)
    var result_text := "MAZE CLEARED" if maze_escaped else "DIMENSION LOST"
    draw_string(ThemeDB.fallback_font, center + Vector2(-115, 8), result_text, HORIZONTAL_ALIGNMENT_LEFT, -1, 25, Color.WHITE)

func _draw_center_text(title: String, subtitle: String) -> void:
    draw_string(ThemeDB.fallback_font, Vector2(0, H * 0.43), title, HORIZONTAL_ALIGNMENT_CENTER, W, 30, Color("#f1eaff"))
    draw_string(ThemeDB.fallback_font, Vector2(0, H * 0.43 + 34), subtitle, HORIZONTAL_ALIGNMENT_CENTER, W, 14, Color("#a8d7ed"))

func _draw_confetti() -> void:
    for item in confetti:
        draw_rect(Rect2(item.p, Vector2(item.r, item.r * 1.8)), item.c, true)

func _draw_player() -> void:
    if phase == Phase.GAME_OVER: return
    var scale_factor := mascot_scale
    var speed := clampf(velocity.length() / 330.0, 0.0, 1.0)
    var wobble := sin(t * 4.0 + player.x * 0.01) * (1.2 + speed * 2.0)
    var body := PackedVector2Array([
        Vector2(-62, 39), Vector2(-68, 20), Vector2(-65, -3), Vector2(-54, -31),
        Vector2(-30, -51 - wobble * 0.3), Vector2(-8, -57 - wobble), Vector2(18, -54 + wobble * 0.2),
        Vector2(43, -43), Vector2(63, -18), Vector2(68, 7), Vector2(64, 34),
        Vector2(45, 47), Vector2(12, 49), Vector2(-25, 49), Vector2(-53, 46)
    ])
    var transformed := PackedVector2Array()
    for p in body: transformed.append(player + p * scale_factor)
    draw_colored_polygon(transformed, Color("#dcebf0"))
    draw_polyline(transformed + PackedVector2Array([transformed[0]]), Color("#8299a8"), 3.0 * scale_factor, true)
    draw_circle(player + Vector2(-18, -26) * scale_factor, 3.2 * scale_factor, Color("#29333d"))
    draw_circle(player + Vector2(16, -26) * scale_factor, 3.2 * scale_factor, Color("#29333d"))
    draw_circle(player + Vector2(-19, -28) * scale_factor, 1.0 * scale_factor, Color.WHITE)
    draw_circle(player + Vector2(15, -28) * scale_factor, 1.0 * scale_factor, Color.WHITE)
    draw_circle(player + Vector2(-35, -8) * scale_factor, 5.0 * scale_factor, Color(1.0, 0.55, 0.65, 0.28))
    draw_circle(player + Vector2(35, -8) * scale_factor, 5.0 * scale_factor, Color(1.0, 0.55, 0.65, 0.28))
