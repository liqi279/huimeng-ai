extends Node2D
## Transparent Godot 4 game layer for the original Dimverse page.
## Deliberately no world/background/grid drawing: the original webpage remains visible.
## The website keeps its own background and welcome UI; this scene owns all gameplay.

enum GameState {
	WAITING, TITLE_PARTICLES, MASCOT_FORM, MASCOT_BLINK, MASCOT_FALL,
	SIGNBOARD, PLAYING, CELEBRATING, BLOCK, MAZE_TRANSITION, MAZE, RETURNING
}

const CYAN := Color("#67eaff")
const PINK := Color("#e58cff")
const PURPLE := Color("#a86cff")
const BODY := Color("#e8f2ec")
const OUTLINE := Color("#71899a")
const GRAVITY := 1450.0
const MOVE_SPEED := 300.0
const MOVE_ACCEL := 1900.0
const MOVE_BRAKE := 2300.0
const DANGO_HALF_HEIGHT := 54.0

var state: GameState = GameState.WAITING
var rng := RandomNumberGenerator.new()
var particles: Array[Dictionary] = []
var crystals: Array[Dictionary] = []
var confetti: Array[Dictionary] = []
var block_particles: Array[Dictionary] = []
var ghosts: Array[Dictionary] = []
var maze_grid: Array = []

var mascot_position := Vector2.ZERO
var mascot_velocity := Vector2.ZERO
var mascot_squash := 0.0
var mascot_squash_velocity := 0.0
var mascot_tilt := 0.0
var floor_y := 620.0
var elapsed := 0.0
var world_time := 0.0
var signboard_elapsed := 0.0
var timer_elapsed := 0.0
var timer_remaining := 60.0
var crystal_spawn_clock := 0.0
var score := 0
var blink := false
var blink_clock := 0.0
var blink_next := 2.0
var landed_notified := false
var pointer_target := Vector2(-1.0, -1.0)

var question_block := Vector2.ZERO
var question_block_size := 76.0
var maze_cols := 0
var maze_rows := 0
var maze_cell_size := 0.0
var maze_origin := Vector2.ZERO
var maze_player_position := Vector2.ZERO
var maze_exit_cell := Vector2i.ZERO
var maze_transition_elapsed := 0.0
var return_elapsed := 0.0
var return_success := false
var return_notified := false

func _ready() -> void:
	floor_y = _viewport_size().y * 0.86
	rng.randomize()
	_register_browser_bridge()
	set_process(false)
	set_process_input(true)
	queue_redraw()
	call_deferred("_on_start_from_web")

func _register_browser_bridge() -> void:
	if not OS.has_feature("web"):
		return
	var browser_window = JavaScriptBridge.get_interface("window")
	if browser_window:
		browser_window.set("hmGodotStart", JavaScriptBridge.create_callback(_on_start_from_web))
	_send_parent("hm-godot-ready")

func _send_parent(message: String) -> void:
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.parent.postMessage('" + message + "', '*');")

func _on_start_from_web(_args: Array = []) -> void:
	if state != GameState.WAITING:
		return
	state = GameState.TITLE_PARTICLES
	elapsed = 0.0
	landed_notified = false
	_build_mascot_particles()
	set_process(true)

func _viewport_size() -> Vector2:
	return get_viewport_rect().size

func _build_mascot_particles() -> void:
	particles.clear()
	var size := _viewport_size()
	for y in range(-43, 44, 4):
		for x in range(-58, 59, 4):
			var normalized := (float(x * x) / (58.0 * 58.0)) + (float(y * y) / (43.0 * 43.0))
			if normalized > 1.0 or rng.randf() > 0.78:
				continue
			if absf(y + 8.0) < 8.0 and (absf(x - 16.0) < 5.0 or absf(x + 16.0) < 5.0):
				continue
			var target := Vector2(size.x * 0.5 + x, size.y * 0.285 + y)
			var start := Vector2(
				rng.randf_range(size.x * 0.27, size.x * 0.73),
				rng.randf_range(size.y * 0.46, size.y * 0.56)
			)
			particles.append({
				"start": start, "position": start, "target": target,
				"delay": rng.randf_range(0.0, 0.55),
				"size": rng.randf_range(1.0, 2.8),
				"color": CYAN.lerp(PINK, rng.randf())
			})

func _process(delta: float) -> void:
	world_time += delta
	var size := _viewport_size()
	match state:
		GameState.TITLE_PARTICLES:
			elapsed += delta
			_update_particles()
			if elapsed >= 2.0:
				state = GameState.MASCOT_FORM
				elapsed = 0.0
		GameState.MASCOT_FORM:
			elapsed += delta
			_update_particles()
			if elapsed >= 0.8:
				state = GameState.MASCOT_BLINK
				elapsed = 0.0
				mascot_position = Vector2(size.x * 0.5, size.y * 0.285)
				blink = true
		GameState.MASCOT_BLINK:
			elapsed += delta
			if elapsed >= 0.22:
				blink = false
				state = GameState.MASCOT_FALL
				elapsed = 0.0
				mascot_velocity = Vector2(0.0, 40.0)
		GameState.MASCOT_FALL:
			_step_mascot(delta, false)
			if mascot_position.y >= floor_y - DANGO_HALF_HEIGHT:
				mascot_position.y = floor_y - DANGO_HALF_HEIGHT
				mascot_velocity = Vector2.ZERO
				mascot_squash = 0.34
				mascot_squash_velocity = 0.0
				state = GameState.SIGNBOARD
				signboard_elapsed = 0.0
				_notify_landed()
		GameState.SIGNBOARD:
			signboard_elapsed += delta
			if signboard_elapsed >= 1.05:
				state = GameState.PLAYING
				timer_elapsed = 0.0
				timer_remaining = 60.0
				crystal_spawn_clock = 0.5
		GameState.PLAYING:
			signboard_elapsed += delta
			_step_mascot(delta, true)
			_update_mascot_spring(delta)
			_update_crystal_challenge(delta)
		GameState.CELEBRATING:
			signboard_elapsed += delta
			_update_confetti(delta)
			elapsed += delta
			if elapsed >= 3.1:
				state = GameState.BLOCK
				elapsed = 0.0
				question_block = Vector2(size.x * 0.5, maxf(190.0, size.y * 0.39))
		GameState.BLOCK:
			signboard_elapsed += delta
			var previous_y := _step_mascot(delta, true)
			_update_mascot_spring(delta)
			var underside := question_block.y + question_block_size * 0.5 + 40.0
			if previous_y > underside and mascot_position.y <= underside and mascot_velocity.y < 0.0 \
				and mascot_position.x > question_block.x - question_block_size * 0.9 \
				and mascot_position.x < question_block.x + question_block_size * 0.9:
				_burst_question_block()
		GameState.MAZE_TRANSITION:
			maze_transition_elapsed += delta
			_update_block_particles(delta)
			if maze_transition_elapsed >= 0.95:
				state = GameState.MAZE
		GameState.MAZE:
			_update_maze_player(delta)
			_update_ghosts(delta)
			_check_maze_collisions()
		GameState.RETURNING:
			return_elapsed += delta
			if return_elapsed >= 1.55 and not return_notified:
				return_notified = true
				_send_parent("hm-godot-gameover")
				set_process(false)
	_update_blink(delta)
	queue_redraw()

func _update_particles() -> void:
	for particle in particles:
		var target: Vector2 = particle["target"]
		if state == GameState.MASCOT_FORM:
			particle["position"] = target + Vector2(
				sin(elapsed * 7.0 + target.x * 0.04) * 1.4,
				cos(elapsed * 5.0 + target.y * 0.03) * 0.8
			)
			continue
		var t := clampf((elapsed - float(particle["delay"])) / 1.25, 0.0, 1.0)
		var eased := 1.0 - pow(1.0 - t, 3.0)
		var start: Vector2 = particle["start"]
		particle["position"] = start.lerp(target, eased)

func _input(event: InputEvent) -> void:
	if state not in [GameState.PLAYING, GameState.BLOCK, GameState.MAZE]:
		return
	if event is InputEventScreenTouch and event.pressed:
		pointer_target = event.position
	elif event is InputEventScreenDrag:
		pointer_target = event.position
	elif event is InputEventMouseButton and event.pressed:
		pointer_target = event.position
	elif event is InputEventMouseMotion and Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT):
		pointer_target = event.position

func _read_direction() -> Vector2:
	var direction := Vector2.ZERO
	if Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT):
		direction.x -= 1.0
	if Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT):
		direction.x += 1.0
	if Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP):
		direction.y -= 1.0
	if Input.is_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN):
		direction.y += 1.0
	if direction == Vector2.ZERO and pointer_target.x >= 0.0:
		direction = pointer_target - mascot_position
		if direction.length() < 16.0:
			pointer_target = Vector2(-1.0, -1.0)
			direction = Vector2.ZERO
	return direction.normalized()

func _step_mascot(delta: float, allow_input: bool) -> float:
	var size := _viewport_size()
	var previous_y := mascot_position.y
	if allow_input:
		var direction := _read_direction()
		var target_velocity := direction * MOVE_SPEED
		var acceleration := MOVE_ACCEL if direction.length_squared() > 0.0 else MOVE_BRAKE
		mascot_velocity = mascot_velocity.move_toward(target_velocity, acceleration * delta)
	else:
		mascot_velocity.y += GRAVITY * delta
	mascot_position += mascot_velocity * delta
	mascot_position.x = clampf(mascot_position.x, 70.0, size.x - 70.0)
	mascot_position.y = clampf(mascot_position.y, 90.0, floor_y - DANGO_HALF_HEIGHT)
	var lean_target := clampf(mascot_velocity.x / MOVE_SPEED, -1.0, 1.0) * 0.105
	mascot_tilt = lerpf(mascot_tilt, lean_target, 1.0 - exp(-10.0 * delta))
	return previous_y

func _update_mascot_spring(delta: float) -> void:
	var target := 0.035 if mascot_velocity.length() > 18.0 else 0.0
	mascot_squash_velocity += (target - mascot_squash) * 64.0 * delta
	mascot_squash_velocity *= exp(-10.5 * delta)
	mascot_squash += mascot_squash_velocity * delta

func _update_blink(delta: float) -> void:
	if blink:
		blink_clock -= delta
		if blink_clock <= 0.0:
			blink = false
			blink_next = rng.randf_range(2.0, 4.2)
	else:
		blink_next -= delta
		if blink_next <= 0.0:
			blink = true
			blink_clock = 0.16

func _notify_landed() -> void:
	if landed_notified:
		return
	landed_notified = true
	_send_parent("hm-godot-landed")

func _update_crystal_challenge(delta: float) -> void:
	timer_elapsed += delta
	timer_remaining = maxf(0.0, 60.0 - timer_elapsed)
	crystal_spawn_clock += delta
	if crystal_spawn_clock >= 0.47 and crystals.size() < 15:
		crystal_spawn_clock = 0.0
		_spawn_random_crystal()
	for i in range(crystals.size() - 1, -1, -1):
		var crystal: Dictionary = crystals[i]
		crystal["age"] = float(crystal["age"]) + delta
		if float(crystal["age"]) >= float(crystal["life"]):
			crystals.remove_at(i)
			continue
		var position: Vector2 = crystal["position"]
		if mascot_position.distance_to(position) < 70.0:
			crystals.remove_at(i)
			score += 1
			if score > 20:
				_begin_celebration()
				return
	if timer_remaining <= 0.0:
		_begin_return(false)

func _spawn_random_crystal() -> void:
	var size := _viewport_size()
	var position := Vector2(
		rng.randf_range(38.0, size.x - 38.0),
		rng.randf_range(88.0, size.y - 42.0)
	)
	for _attempt in range(8):
		if position.distance_to(mascot_position) >= 110.0:
			break
		position = Vector2(
			rng.randf_range(38.0, size.x - 38.0),
			rng.randf_range(88.0, size.y - 42.0)
		)
	crystals.append({
		"position": position, "age": 0.0,
		"life": rng.randf_range(7.5, 12.5), "phase": rng.randf_range(0.0, TAU)
	})

func _begin_celebration() -> void:
	state = GameState.CELEBRATING
	elapsed = 0.0
	confetti.clear()
	for i in range(150):
		confetti.append({
			"position": Vector2(rng.randf_range(0.0, _viewport_size().x), rng.randf_range(-360.0, 0.0)),
			"velocity": Vector2(rng.randf_range(-150.0, 150.0), rng.randf_range(80.0, 360.0)),
			"rotation": rng.randf_range(0.0, TAU), "spin": rng.randf_range(-5.0, 5.0),
			"size": rng.randf_range(3.0, 8.0),
			"color": [CYAN, PINK, Color("#ffe58a"), Color("#8cffc1"), Color.WHITE][i % 5]
		})

func _update_confetti(delta: float) -> void:
	for item in confetti:
		var position: Vector2 = item["position"]
		var velocity: Vector2 = item["velocity"]
		velocity.y += 260.0 * delta
		position += velocity * delta
		item["position"] = position
		item["velocity"] = velocity
		item["rotation"] = float(item["rotation"]) + float(item["spin"]) * delta

func _burst_question_block() -> void:
	block_particles.clear()
	for i in range(180):
		var angle := rng.randf_range(0.0, TAU)
		var speed := rng.randf_range(90.0, 520.0)
		block_particles.append({
			"position": question_block + Vector2(rng.randf_range(-30.0, 30.0), rng.randf_range(-30.0, 30.0)),
			"velocity": Vector2(cos(angle), sin(angle)) * speed,
			"age": 0.0, "life": rng.randf_range(0.55, 1.25),
			"size": rng.randf_range(1.5, 5.0),
			"color": [Color("#fff0a6"), Color("#ffc34e"), CYAN, Color("#d7a7ff")][i % 4]
		})
	state = GameState.MAZE_TRANSITION
	maze_transition_elapsed = 0.0
	_generate_maze()
	_send_parent("hm-godot-stage-maze")

func _update_block_particles(delta: float) -> void:
	for item in block_particles:
		var position: Vector2 = item["position"]
		var velocity: Vector2 = item["velocity"]
		velocity.y += 260.0 * delta
		position += velocity * delta
		item["position"] = position
		item["velocity"] = velocity
		item["age"] = float(item["age"]) + delta

func _generate_maze() -> void:
	var size := _viewport_size()
	maze_cols = clampi(int((size.x - 40.0) / 28.0), 11, 31)
	maze_rows = clampi(int((size.y - 150.0) / 28.0), 11, 21)
	if maze_cols % 2 == 0:
		maze_cols -= 1
	if maze_rows % 2 == 0:
		maze_rows -= 1
	maze_grid.clear()
	for y in range(maze_rows):
		var row: Array[int] = []
		for x in range(maze_cols):
			row.append(1)
		maze_grid.append(row)

	var stack: Array[Vector2i] = [Vector2i(1, 1)]
	maze_grid[1][1] = 0
	while not stack.is_empty():
		var current: Vector2i = stack.back()
		var directions: Array[Vector2i] = [
			Vector2i(0, -2), Vector2i(2, 0), Vector2i(0, 2), Vector2i(-2, 0)
		]
		directions.shuffle()
		var next_cell := Vector2i(-1, -1)
		for direction in directions:
			var candidate := current + direction
			if candidate.x > 0 and candidate.y > 0 and candidate.x < maze_cols - 1 \
				and candidate.y < maze_rows - 1 and maze_grid[candidate.y][candidate.x] == 1:
				next_cell = candidate
				break
		if next_cell.x >= 0:
			var between := current + Vector2i(
				int(signf(float(next_cell.x - current.x))),
				int(signf(float(next_cell.y - current.y)))
			)
			maze_grid[between.y][between.x] = 0
			maze_grid[next_cell.y][next_cell.x] = 0
			stack.append(next_cell)
		else:
			stack.pop_back()

	maze_exit_cell = Vector2i(maze_cols - 2, maze_rows - 2)
	maze_grid[maze_exit_cell.y][maze_exit_cell.x] = 0
	maze_cell_size = minf((size.x - 34.0) / maze_cols, (size.y - 142.0) / maze_rows)
	var board_size := Vector2(maze_cell_size * maze_cols, maze_cell_size * maze_rows)
	maze_origin = Vector2((size.x - board_size.x) * 0.5, maxf(78.0, (size.y - board_size.y) * 0.5 + 32.0))
	maze_player_position = maze_origin + Vector2(1.5, 1.5) * maze_cell_size
	mascot_position = maze_player_position
	mascot_velocity = Vector2.ZERO
	pointer_target = Vector2(-1.0, -1.0)
	ghosts = [
		_make_ghost(Vector2i(maze_cols - 2, 1), Color("#ff76d7"), 2.0),
		_make_ghost(Vector2i(1, maze_rows - 2), Color("#78eaff"), 2.35)
	]

func _make_ghost(cell: Vector2i, tint: Color, speed: float) -> Dictionary:
	return {
		"cell": cell, "from": cell, "to": cell, "progress": 1.0,
		"speed": speed, "path_at": 0.0, "color": tint, "position": Vector2.ZERO
	}

func _maze_cell_at(position: Vector2) -> Vector2i:
	return Vector2i(
		floori((position.x - maze_origin.x) / maze_cell_size),
		floori((position.y - maze_origin.y) / maze_cell_size)
	)

func _maze_can_occupy(position: Vector2) -> bool:
	var radius := maze_cell_size * 0.34
	var offsets := [
		Vector2(-radius, -radius), Vector2(radius, -radius),
		Vector2(-radius, radius), Vector2(radius, radius)
	]
	for offset in offsets:
		var cell := _maze_cell_at(position + offset)
		if cell.x < 0 or cell.y < 0 or cell.x >= maze_cols or cell.y >= maze_rows:
			return false
		if maze_grid[cell.y][cell.x] != 0:
			return false
	return true

func _find_maze_path(start_cell: Vector2i, target_cell: Vector2i) -> Array[Vector2i]:
	var queue: Array[Vector2i] = [start_cell]
	var previous: Dictionary = {}
	var sentinel := Vector2i(-999, -999)
	previous[start_cell] = sentinel
	var head := 0
	while head < queue.size():
		var current := queue[head]
		head += 1
		if current == target_cell:
			break
		var directions := [Vector2i(0, -1), Vector2i(1, 0), Vector2i(0, 1), Vector2i(-1, 0)]
		for direction in directions:
			var next_cell: Vector2i = current + direction
			if next_cell.x < 0 or next_cell.y < 0 or next_cell.x >= maze_cols or next_cell.y >= maze_rows:
				continue
			if maze_grid[next_cell.y][next_cell.x] != 0 or previous.has(next_cell):
				continue
			previous[next_cell] = current
			queue.append(next_cell)
	if not previous.has(target_cell):
		return []
	var path: Array[Vector2i] = []
	var cursor := target_cell
	while cursor != sentinel:
		path.push_front(cursor)
		cursor = previous.get(cursor, sentinel)
	return path

func _update_ghosts(delta: float) -> void:
	for ghost in ghosts:
		if float(ghost["progress"]) >= 1.0:
			ghost["cell"] = ghost["to"]
			if world_time >= float(ghost["path_at"]):
				var player_cell := _maze_cell_at(maze_player_position)
				var path := _find_maze_path(ghost["cell"], player_cell)
				if path.size() > 1:
					ghost["from"] = ghost["cell"]
					ghost["to"] = path[1]
					ghost["progress"] = 0.0
				ghost["path_at"] = world_time + 0.16
		if float(ghost["progress"]) < 1.0:
			ghost["progress"] = minf(1.0, float(ghost["progress"]) + delta * float(ghost["speed"]))
		var from_cell: Vector2i = ghost["from"]
		var to_cell: Vector2i = ghost["to"]
		var p := float(ghost["progress"])
		var cell_pos := Vector2(
			lerpf(float(from_cell.x), float(to_cell.x), p),
			lerpf(float(from_cell.y), float(to_cell.y), p)
		)
		ghost["position"] = maze_origin + (cell_pos + Vector2(0.5, 0.5)) * maze_cell_size

func _update_maze_player(delta: float) -> void:
	var direction := _read_direction()
	var speed := maze_cell_size * 3.5
	var target := maze_player_position + direction * speed * delta
	if _maze_can_occupy(Vector2(target.x, maze_player_position.y)):
		maze_player_position.x = target.x
	if _maze_can_occupy(Vector2(maze_player_position.x, target.y)):
		maze_player_position.y = target.y
	mascot_position = maze_player_position
	mascot_velocity = direction * speed
	var lean_target := clampf(direction.x * 0.11, -0.11, 0.11)
	mascot_tilt = lerpf(mascot_tilt, lean_target, 1.0 - exp(-10.0 * delta))
	var squash_target := 0.035 if direction.length_squared() > 0.0 else 0.0
	mascot_squash = lerpf(mascot_squash, squash_target, minf(1.0, delta * 8.0))

func _check_maze_collisions() -> void:
	for ghost in ghosts:
		var ghost_position: Vector2 = ghost["position"]
		if maze_player_position.distance_to(ghost_position) < maze_cell_size * 0.62:
			_begin_return(false)
			return
	var exit_position := maze_origin + (Vector2(maze_exit_cell) + Vector2(0.5, 0.5)) * maze_cell_size
	if maze_player_position.distance_to(exit_position) < maze_cell_size * 0.42:
		_begin_return(true)

func _begin_return(success: bool) -> void:
	if state == GameState.RETURNING:
		return
	return_success = success
	return_elapsed = 0.0
	return_notified = false
	state = GameState.RETURNING

func _format_time(seconds: float) -> String:
	var total := maxi(0, ceili(seconds))
	return "%02d:%02d" % [floori(float(total) / 60.0), total % 60]

func _draw() -> void:
	var size := _viewport_size()
	if state in [GameState.TITLE_PARTICLES, GameState.MASCOT_FORM]:
		for particle in particles:
			var pos: Vector2 = particle["position"]
			var color: Color = particle["color"]
			var dot_size := float(particle["size"])
			draw_circle(pos, dot_size * 3.2, Color(color.r, color.g, color.b, 0.16))
			draw_circle(pos, dot_size, color)
	if state in [
		GameState.MASCOT_BLINK, GameState.MASCOT_FALL, GameState.SIGNBOARD,
		GameState.PLAYING, GameState.CELEBRATING, GameState.BLOCK
	]:
		_draw_mascot(mascot_position, 1.0)
	if state in [GameState.SIGNBOARD, GameState.PLAYING, GameState.CELEBRATING, GameState.BLOCK]:
		if signboard_elapsed < 4.2:
			_draw_signboard(size)
	if state in [GameState.PLAYING, GameState.CELEBRATING, GameState.BLOCK]:
		for crystal in crystals:
			_draw_crystal(crystal)
		_draw_hud()
	if state == GameState.CELEBRATING or state == GameState.BLOCK:
		_draw_confetti()
		_draw_celebration_text(size)
	if state == GameState.BLOCK:
		_draw_question_block()
	if state == GameState.MAZE_TRANSITION:
		_draw_maze(maze_transition_elapsed / 0.95)
		_draw_block_particles()
		var mini_scale := minf(0.31, maze_cell_size * 0.74 / 134.0)
		_draw_mascot(mascot_position, mini_scale)
	if state == GameState.MAZE:
		_draw_maze(1.0)
		for ghost in ghosts:
			_draw_ghost(ghost)
		var mini_scale := minf(0.31, maze_cell_size * 0.74 / 134.0)
		_draw_mascot(mascot_position, mini_scale)
		draw_string(ThemeDB.fallback_font, Vector2(size.x * 0.5 - 170.0, 75.0),
			"找到漩涡出口 · 避开两名幽灵守卫", HORIZONTAL_ALIGNMENT_CENTER, 340.0, 14, Color("#d7edff"))
	if state == GameState.RETURNING:
		_draw_return_vortex(size)

func _draw_signboard(size: Vector2) -> void:
	var t := clampf(signboard_elapsed / 0.9, 0.0, 1.0)
	var eased := 1.0 - pow(1.0 - t, 3.0)
	var center_y := size.y * 0.48
	var target_y := lerpf(-150.0, center_y, eased)
	var compact_t := clampf((signboard_elapsed - 2.2) / 0.65, 0.0, 1.0)
	var y := lerpf(target_y, 110.0, compact_t)
	var width := lerpf(minf(430.0, size.x - 36.0), minf(270.0, size.x - 32.0), compact_t)
	var height := lerpf(164.0, 76.0, compact_t)
	var rect := Rect2(size.x * 0.5 - width * 0.5, y - height * 0.5, width, height)
	draw_rect(rect, Color(0.02, 0.06, 0.15, 0.96), true)
	draw_rect(rect, CYAN, false, 1.8)
	draw_rect(Rect2(rect.position + Vector2(6, 6), rect.size - Vector2(12, 12)), Color(0.55, 0.8, 1.0, 0.18), false, 1.0)
	draw_line(Vector2(rect.position.x + width * 0.24, rect.position.y), Vector2(rect.position.x + width * 0.24, rect.position.y - 18), PINK, 2.0)
	draw_line(Vector2(rect.position.x + width * 0.76, rect.position.y), Vector2(rect.position.x + width * 0.76, rect.position.y - 18), CYAN, 2.0)
	if compact_t < 0.95:
		draw_string(ThemeDB.fallback_font, Vector2(size.x * 0.5 - width * 0.45, rect.position.y + 29.0),
			"DIMENSIONAL TRIAL · 01", HORIZONTAL_ALIGNMENT_CENTER, width * 0.9, 10, CYAN)
		draw_string(ThemeDB.fallback_font, Vector2(size.x * 0.5 - width * 0.45, rect.position.y + 59.0),
			"能量晶体收集挑战", HORIZONTAL_ALIGNMENT_CENTER, width * 0.9, 23, Color("#effbff"))
		draw_string(ThemeDB.fallback_font, Vector2(size.x * 0.5 - width * 0.45, rect.position.y + 82.0),
			"在 60 秒内吞食 21 枚晶体，开启下一道次元门", HORIZONTAL_ALIGNMENT_CENTER, width * 0.9, 12, Color("#c8e2fa"))
	draw_string(ThemeDB.fallback_font, Vector2(size.x * 0.5 - width * 0.4, rect.position.y + height - 12.0),
		_format_time(timer_remaining), HORIZONTAL_ALIGNMENT_CENTER, width * 0.8, 31 if compact_t < 0.95 else 25, Color("#a5f3fc"))

func _draw_hud() -> void:
	var panel := Rect2(20.0, 78.0, 320.0, 58.0)
	draw_rect(panel, Color(0.015, 0.045, 0.11, 0.88), true)
	draw_rect(panel, Color(0.25, 0.82, 0.95, 0.52), false, 1.2)
	draw_line(Vector2(178.0, 88.0), Vector2(178.0, 126.0), Color(0.4, 0.75, 0.9, 0.35), 1.0)
	draw_string(ThemeDB.fallback_font, Vector2(34.0, 98.0), "剩余时间", HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color("#b8d9ed"))
	draw_string(ThemeDB.fallback_font, Vector2(34.0, 124.0), _format_time(timer_remaining), HORIZONTAL_ALIGNMENT_LEFT, -1, 22, CYAN)
	draw_string(ThemeDB.fallback_font, Vector2(198.0, 98.0), "吞食晶体", HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color("#d7c4fa"))
	draw_string(ThemeDB.fallback_font, Vector2(198.0, 125.0), "%02d / 21" % score, HORIZONTAL_ALIGNMENT_LEFT, -1, 22, Color("#f0abfc"))

func _draw_crystal(crystal: Dictionary) -> void:
	var position: Vector2 = crystal["position"]
	var phase := float(crystal["phase"])
	var pulse := 1.0 + sin(world_time * 3.4 + phase) * 0.14
	draw_circle(position, 23.0 * pulse, Color(0.1, 0.85, 1.0, 0.09))
	draw_circle(position, 15.0 * pulse, Color(0.1, 0.85, 1.0, 0.13))
	var points := PackedVector2Array([
		Vector2(0.0, -12.0 * pulse), Vector2(9.0 * pulse, 0.0),
		Vector2(0.0, 12.0 * pulse), Vector2(-9.0 * pulse, 0.0)
	])
	draw_set_transform(position, world_time * 0.35 + phase, Vector2.ONE)
	draw_colored_polygon(points, CYAN)
	draw_polyline(PackedVector2Array([points[0], points[1], points[2], points[3], points[0]]), Color("#e8fdff"), 1.2, true)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)

func _draw_confetti() -> void:
	for item in confetti:
		var position: Vector2 = item["position"]
		var size := float(item["size"])
		draw_set_transform(position, float(item["rotation"]), Vector2.ONE)
		draw_rect(Rect2(-size * 0.5, -size * 0.3, size, size * 0.62), item["color"], true)
		draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)

func _draw_celebration_text(size: Vector2) -> void:
	draw_string(ThemeDB.fallback_font, Vector2(0.0, size.y * 0.22),
		"21+  能量收集完成！", HORIZONTAL_ALIGNMENT_CENTER, size.x, 30, Color("#fff3ff"))
	draw_string(ThemeDB.fallback_font, Vector2(0.0, size.y * 0.22 + 30.0),
		"太棒啦！下一道次元门已经解锁", HORIZONTAL_ALIGNMENT_CENTER, size.x, 14, CYAN)

func _draw_question_block() -> void:
	var rect := Rect2(question_block - Vector2.ONE * question_block_size * 0.5, Vector2.ONE * question_block_size)
	draw_rect(rect.grow(4.0), Color("#8b4b14"), true)
	draw_rect(rect, Color("#ffc34e"), true)
	draw_rect(rect, Color("#fff0a3"), false, 3.0)
	draw_rect(rect.grow(-7.0), Color("#d8791f"), false, 2.0)
	draw_string(ThemeDB.fallback_font, question_block + Vector2(-15.0, 17.0), "?", HORIZONTAL_ALIGNMENT_CENTER, 30.0, 48, Color("#fff3b0"))
	draw_string(ThemeDB.fallback_font, question_block + Vector2(-130.0, question_block_size * 0.9),
		"从下方撞击方块", HORIZONTAL_ALIGNMENT_CENTER, 260.0, 13, Color("#fff0bd"))

func _draw_block_particles() -> void:
	for item in block_particles:
		var age := float(item["age"])
		var life := float(item["life"])
		if age >= life:
			continue
		var color: Color = item["color"]
		color.a = 1.0 - age / life
		var position: Vector2 = item["position"]
		var size := float(item["size"])
		draw_rect(Rect2(position, Vector2.ONE * size), color, true)

func _draw_maze(reveal: float) -> void:
	var board_size := Vector2(maze_cols * maze_cell_size, maze_rows * maze_cell_size)
	var board_rect := Rect2(maze_origin, board_size)
	draw_rect(board_rect.grow(10.0), Color(0.01, 0.025, 0.08, 0.86 * reveal), true)
	draw_rect(board_rect.grow(10.0), Color(0.2, 0.85, 1.0, 0.45 * reveal), false, 1.2)
	for y in range(maze_rows):
		for x in range(maze_cols):
			var cell_rect := Rect2(
				maze_origin + Vector2(x, y) * maze_cell_size,
				Vector2.ONE * maze_cell_size
			)
			if maze_grid[y][x] == 1:
				var wall_color := Color(0.13, 0.2, 0.36, 0.96 * reveal)
				draw_rect(cell_rect.grow(-1.0), wall_color, true)
				draw_rect(cell_rect.grow(-2.0), Color(0.3, 0.82, 1.0, 0.22 * reveal), false, 0.8)
			else:
				draw_rect(cell_rect, Color(0.015, 0.04, 0.1, 0.56 * reveal), true)
	draw_rect(board_rect, Color(0.45, 0.9, 1.0, 0.55 * reveal), false, 1.4)
	var exit_position := maze_origin + (Vector2(maze_exit_cell) + Vector2(0.5, 0.5)) * maze_cell_size
	_draw_maze_vortex(exit_position, maze_cell_size * 0.38)

func _draw_maze_vortex(position: Vector2, radius: float) -> void:
	for i in range(4):
		var tint := CYAN if i % 2 == 0 else Color("#d78cff")
		var start := world_time * (0.9 if i % 2 == 0 else -0.9) + float(i) * 0.7
		draw_arc(position, radius * (0.9 - float(i) * 0.19), start, start + 5.0, 42, tint, maxf(1.4, radius * 0.11), true)
	draw_circle(position, radius * 0.12, Color.WHITE)

func _draw_ghost(ghost: Dictionary) -> void:
	var position: Vector2 = ghost["position"]
	var radius := maze_cell_size * 0.31
	var bob := sin(world_time * 7.0 + float(ghost["cell"].x)) * maze_cell_size * 0.035
	var tint: Color = ghost["color"]
	var center := position + Vector2(0.0, bob)
	draw_circle(center, radius, tint)
	draw_rect(Rect2(center.x - radius, center.y - radius * 0.1, radius * 2.0, radius), tint, true)
	var wave := PackedVector2Array([
		center + Vector2(-radius, radius * 0.65),
		center + Vector2(-radius * 0.48, radius * 0.42),
		center + Vector2(0.0, radius * 0.68),
		center + Vector2(radius * 0.48, radius * 0.42),
		center + Vector2(radius, radius * 0.65)
	])
	draw_colored_polygon(wave, tint)
	draw_circle(center + Vector2(-radius * 0.3, -radius * 0.08), radius * 0.12, Color("#17213b"))
	draw_circle(center + Vector2(radius * 0.27, -radius * 0.08), radius * 0.12, Color("#17213b"))
	draw_circle(center + Vector2(-radius * 0.33, -radius * 0.17), radius * 0.05, Color.WHITE)
	draw_circle(center + Vector2(radius * 0.24, -radius * 0.17), radius * 0.05, Color.WHITE)

func _draw_return_vortex(size: Vector2) -> void:
	var progress := clampf(return_elapsed / 1.25, 0.0, 1.0)
	draw_rect(Rect2(Vector2.ZERO, size), Color(0.008, 0.012, 0.04, progress), true)
	var center := size * 0.5
	var max_radius := size.length() * 0.72 * progress
	for i in range(8):
		var radius := max_radius * (0.96 - float(i) * 0.105)
		var tint := [CYAN, PURPLE, PINK, Color("#8be9fd")][i % 4]
		var rotation := world_time * (1.4 if i % 2 == 0 else -1.2) + float(i) * 0.62
		draw_arc(center, maxf(2.0, radius), rotation, rotation + 5.35, 72, tint, 3.0 + float(i) * 0.45, true)
	draw_circle(center, 8.0 + progress * 20.0, Color(0.9, 0.98, 1.0, progress))
	if return_elapsed > 0.2:
		var caption := "次元探索完成" if return_success else "次元空间 · 再会"
		draw_string(ThemeDB.fallback_font, Vector2(0.0, size.y * 0.82), caption,
			HORIZONTAL_ALIGNMENT_CENTER, size.x, 18, Color(0.9, 0.98, 1.0, progress))

func _dango_outline(wobble: float) -> PackedVector2Array:
	var points := PackedVector2Array()
	_append_bezier(points, Vector2(-62, 39), Vector2(-69, 33), Vector2(-68, 15), Vector2(-65, -2), 7)
	_append_bezier(points, Vector2(-65, -2), Vector2(-62, -27), Vector2(-48, -48), Vector2(-29, -53 - wobble * 0.35), 8)
	_append_bezier(points, Vector2(-29, -53 - wobble * 0.35), Vector2(-12, -59 - wobble), Vector2(11, -59 + wobble * 0.3), Vector2(29, -51), 8)
	_append_bezier(points, Vector2(29, -51), Vector2(50, -43), Vector2(64, -23), Vector2(67, -1), 8)
	_append_bezier(points, Vector2(67, -1), Vector2(70, 15), Vector2(69, 32), Vector2(62, 40), 7)
	_append_bezier(points, Vector2(62, 40), Vector2(53, 49), Vector2(29, 48 + wobble * 0.15), Vector2(10, 48), 8)
	_append_bezier(points, Vector2(10, 48), Vector2(-14, 50), Vector2(-48, 50 - wobble * 0.12), Vector2(-62, 39), 8)
	points.append(points[0])
	return points

func _append_bezier(points: PackedVector2Array, p0: Vector2, p1: Vector2, p2: Vector2, p3: Vector2, steps: int) -> void:
	for i in range(1, steps + 1):
		var t := float(i) / float(steps)
		var inv := 1.0 - t
		points.append(inv * inv * inv * p0 + 3.0 * inv * inv * t * p1 + 3.0 * inv * t * t * p2 + t * t * t * p3)

func _draw_mascot(position: Vector2, scale: float) -> void:
	var size := _viewport_size()
	var air_height := maxf(0.0, floor_y - DANGO_HALF_HEIGHT - position.y)
	var shadow_scale := clampf(1.0 - air_height / maxf(1.0, size.y), 0.45, 1.0)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	var shadow_y := position.y + 18.0 if state in [GameState.MAZE, GameState.MAZE_TRANSITION] else floor_y - 8.0
	draw_circle(Vector2(position.x, shadow_y), 42.0 * shadow_scale * scale, Color(0.0, 0.0, 0.0, 0.12))
	var speed := clampf(mascot_velocity.length() / MOVE_SPEED, 0.0, 1.0)
	var wobble := sin(world_time * 4.0 + position.x * 0.012) * (1.2 + speed * 2.4)
	var body_scale := Vector2(scale * (1.0 + mascot_squash), scale * (1.0 - mascot_squash * 0.7 + sin(world_time * 3.2) * 0.012))
	draw_set_transform(position + Vector2(0.0, sin(world_time * 4.0) * 1.1), mascot_tilt, body_scale)
	var outline := _dango_outline(wobble)
	draw_colored_polygon(outline, BODY)
	draw_colored_polygon(PackedVector2Array([
		Vector2(-53, 27), Vector2(-37, 40), Vector2(5, 43), Vector2(48, 32),
		Vector2(38, 47), Vector2(-32, 47)
	]), Color(0.58, 0.69, 0.72, 0.16))
	draw_circle(Vector2(-23, -31), 17.0, Color(1.0, 1.0, 1.0, 0.28))
	draw_circle(Vector2(-34, -10), 5.0, Color(1.0, 1.0, 1.0, 0.35))
	draw_polyline(outline, OUTLINE, 3.0, true)
	draw_polyline(outline, Color(0.96, 0.99, 1.0, 0.48), 1.0, true)
	var look := Vector2(clampf(mascot_velocity.x / MOVE_SPEED, -1.0, 1.0) * 2.2, clampf(mascot_velocity.y / MOVE_SPEED, -1.0, 1.0) * 1.5)
	if blink:
		draw_line(Vector2(-22.0, -4.0) + look, Vector2(-13.0, -4.0) + look, Color("#292923"), 2.4, true)
		draw_line(Vector2(13.0, -4.0) + look, Vector2(22.0, -4.0) + look, Color("#292923"), 2.4, true)
	else:
		_draw_ellipse_eye(Vector2(-18.0, -5.0) + look)
		_draw_ellipse_eye(Vector2(18.0, -5.0) + look)
	draw_circle(Vector2(-34.0, 7.0), 5.5, Color(1.0, 0.58, 0.66, 0.22))
	draw_circle(Vector2(34.0, 7.0), 5.5, Color(1.0, 0.58, 0.66, 0.22))
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)

func _draw_ellipse_eye(position: Vector2) -> void:
	draw_circle(position, 4.0, Color("#262720"))
	draw_circle(position + Vector2(-1.0, -2.0), 1.2, Color.WHITE)

