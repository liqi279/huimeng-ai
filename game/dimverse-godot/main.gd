extends Node2D
## Godot 4 transparent gameplay overlay.
## The original website owns the background, title, navigation and tutorial DOM.
## This scene only renders the mascot, intro particles and gameplay entities.

enum IntroState { WAITING, TITLE_PARTICLES, MASCOT_FORM, MASCOT_BLINK, MASCOT_FALL, PLAYING }

const VIEW_SIZE := Vector2(1280.0, 720.0)
const CYAN := Color("#67eaff")
const PINK := Color("#e58cff")
const PURPLE := Color("#a86cff")
const FLOOR_Y := 620.0
const MOVE_SPEED := 260.0
const MOVE_ACCEL := 1900.0
const MOVE_BRAKE := 2300.0
const GRAVITY := 1450.0
const MASCOT_HALF_HEIGHT := 54.0

var state: IntroState = IntroState.WAITING
var rng := RandomNumberGenerator.new()
var particles: Array[Dictionary] = []
var mascot_position := Vector2(640.0, 190.0)
var mascot_velocity := Vector2.ZERO
var mascot_squash := 0.0
var mascot_squash_velocity := 0.0
var mascot_tilt := 0.0
var elapsed := 0.0
var world_time := 0.0
var blink := false
var blink_clock := 0.0
var blink_next := 2.0
var landed_notified := false
var crystals: Array[Vector2] = [Vector2(300, 530), Vector2(520, 455), Vector2(900, 500), Vector2(1080, 390)]
var score := 0
var drag_camera := false

func _ready() -> void:
	rng.randomize()
	_register_browser_bridge()
	set_process(false)
	queue_redraw()
	# The game iframe is created only after the user presses “开启”. Start the
	# intro here as well as exposing the parent callback, so a missed or delayed
	# postMessage handshake cannot leave the now-visible overlay permanently blank.
	call_deferred("_on_start_from_web")

func _register_browser_bridge() -> void:
	if not OS.has_feature("web"):
		return
	var browser_window = JavaScriptBridge.get_interface("window")
	if browser_window:
		browser_window.set("hmGodotStart", JavaScriptBridge.create_callback(_on_start_from_web))
	JavaScriptBridge.eval("window.parent.postMessage('hm-godot-ready', '*');")

func _on_start_from_web(_args = []) -> void:
	if state != IntroState.WAITING:
		return
	state = IntroState.TITLE_PARTICLES
	elapsed = 0.0
	landed_notified = false
	_build_mascot_particles()
	set_process(true)

func _build_mascot_particles() -> void:
	particles.clear()
	# Dense oval silhouette sampled as a soft body; the eyes remain empty.
	for y in range(-43, 44, 4):
		for x in range(-58, 59, 4):
			var normalized := (float(x * x) / (58.0 * 58.0)) + (float(y * y) / (43.0 * 43.0))
			if normalized > 1.0 or rng.randf() > 0.78:
				continue
			if absf(y + 8.0) < 8.0 and (absf(x - 16.0) < 5.0 or absf(x + 16.0) < 5.0):
				continue
			var target := Vector2(640.0 + x, 205.0 + y)
			# 粒子從原歡迎標題所在的水平字帶散開，再向上匯聚成團子；
			# 不再從整個畫面四周隨機飛入，避免看起來像另一個獨立遊戲開場。
			var start := Vector2(
				rng.randf_range(350.0, 930.0),
				rng.randf_range(335.0, 405.0)
			)
			particles.append({
				"start": start,
				"position": start,
				"target": target,
				"delay": rng.randf_range(0.0, 0.55),
				"size": rng.randf_range(1.0, 2.8),
				"color": CYAN.lerp(PINK, rng.randf())
			})

func _process(delta: float) -> void:
	world_time += delta
	elapsed += delta
	match state:
		IntroState.TITLE_PARTICLES:
			_update_particles()
			if elapsed >= 2.0:
				state = IntroState.MASCOT_FORM
				elapsed = 0.0
		IntroState.MASCOT_FORM:
			_update_particles()
			if elapsed >= 0.8:
				state = IntroState.MASCOT_BLINK
				elapsed = 0.0
				mascot_position = Vector2(640.0, 205.0)
				blink = true
		IntroState.MASCOT_BLINK:
			if elapsed >= 0.22:
				blink = false
				state = IntroState.MASCOT_FALL
				elapsed = 0.0
				mascot_velocity = Vector2(0.0, 40.0)
		IntroState.MASCOT_FALL:
			_step_mascot(delta, false)
			if mascot_position.y >= FLOOR_Y - MASCOT_HALF_HEIGHT:
				mascot_position.y = FLOOR_Y - MASCOT_HALF_HEIGHT
				mascot_velocity = Vector2.ZERO
				mascot_squash = 0.34
				mascot_squash_velocity = 0.0
				state = IntroState.PLAYING
				_notify_landed()
		IntroState.PLAYING:
			_step_mascot(delta, true)
			_check_crystals()
			_update_blink(delta)
	_update_mascot_spring(delta)
	queue_redraw()

func _update_particles() -> void:
	for particle in particles:
		var target: Vector2 = particle["target"]
		if state == IntroState.MASCOT_FORM:
			# 保持已汇聚的团子轮廓，只做轻微能量脉动，不能在阶段切换时退回起点。
			particle["position"] = target + Vector2(sin(elapsed * 7.0 + target.x * 0.04) * 1.4, cos(elapsed * 5.0 + target.y * 0.03) * 0.8)
			continue
		var t := clampf((elapsed - float(particle["delay"])) / 1.25, 0.0, 1.0)
		var eased := 1.0 - pow(1.0 - t, 3.0)
		var start: Vector2 = particle["start"]
		particle["position"] = start.lerp(target, eased)

func _step_mascot(delta: float, allow_input: bool) -> void:
	if allow_input:
		var direction := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
		if Input.is_key_pressed(KEY_A): direction.x -= 1.0
		if Input.is_key_pressed(KEY_D): direction.x += 1.0
		if Input.is_key_pressed(KEY_W): direction.y -= 1.0
		if Input.is_key_pressed(KEY_S): direction.y += 1.0
		direction = direction.normalized()
		var target_velocity := direction * MOVE_SPEED
		var acceleration := MOVE_ACCEL if direction.length_squared() > 0.0 else MOVE_BRAKE
		mascot_velocity = mascot_velocity.move_toward(target_velocity, acceleration * delta)
	else:
		mascot_velocity.y += GRAVITY * delta
	mascot_position += mascot_velocity * delta
	mascot_position.x = clampf(mascot_position.x, 70.0, VIEW_SIZE.x - 70.0)
	mascot_position.y = clampf(mascot_position.y, 90.0, FLOOR_Y - MASCOT_HALF_HEIGHT)
	var lean_target := clampf(mascot_velocity.x / MOVE_SPEED, -1.0, 1.0) * 0.105
	mascot_tilt = lerp(mascot_tilt, lean_target, 1.0 - exp(-10.0 * delta))

func _update_mascot_spring(delta: float) -> void:
	if state != IntroState.PLAYING:
		return
	# Damped spring: the landing squash rebounds before settling into a soft idle.
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

func _check_crystals() -> void:
	for i in range(crystals.size() - 1, -1, -1):
		if mascot_position.distance_to(crystals[i]) < 68.0:
			crystals.remove_at(i)
			score += 1
			if OS.has_feature("web"):
				JavaScriptBridge.eval("window.parent.postMessage('hm-godot-score-" + str(score) + "', '*');")

func _notify_landed() -> void:
	if landed_notified:
		return
	landed_notified = true
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.parent.postMessage('hm-godot-landed', '*');")

func _draw() -> void:
	# Deliberately no world/background/grid drawing: the original webpage remains visible.
	if state in [IntroState.TITLE_PARTICLES, IntroState.MASCOT_FORM]:
		for particle in particles:
			var pos: Vector2 = particle["position"]
			var color: Color = particle["color"]
			var size := float(particle["size"])
			draw_circle(pos, size * 3.2, Color(color.r, color.g, color.b, 0.16))
			draw_circle(pos, size, color)
	if state in [IntroState.MASCOT_BLINK, IntroState.MASCOT_FALL, IntroState.PLAYING]:
		_draw_mascot(mascot_position)
	if state == IntroState.PLAYING:
		for crystal in crystals:
			var pulse := 1.0 + 0.16 * sin(world_time * 3.0 + crystal.x)
			draw_circle(crystal, 13.0 * pulse, Color(0.1, 0.85, 1.0, 0.14))
			draw_colored_polygon(PackedVector2Array([
				crystal + Vector2(0, -9), crystal + Vector2(8, 0),
				crystal + Vector2(0, 9), crystal + Vector2(-8, 0)
			]), CYAN)

func _draw_mascot(pos: Vector2) -> void:
	var height := maxf(0.0, FLOOR_Y - MASCOT_HALF_HEIGHT - pos.y)
	var shadow_scale := clampf(1.0 - height / 900.0, 0.48, 1.0)
	var shadow_alpha := clampf(0.27 - height / 1900.0, 0.08, 0.27)
	draw_set_transform(Vector2(pos.x, FLOOR_Y - 9.0), 0.0, Vector2(shadow_scale, shadow_scale * 0.34))
	draw_circle(Vector2.ZERO, 48.0, Color(0.0, 0.0, 0.0, shadow_alpha))
	draw_circle(Vector2(0.0, -2.0), 35.0, Color(0.05, 0.76, 0.96, shadow_alpha * 0.28))

	var speed := clampf(mascot_velocity.length() / MOVE_SPEED, 0.0, 1.0)
	var breathe := sin(world_time * 3.2) * 0.012
	var body_scale := Vector2(1.0 + mascot_squash, 1.0 - mascot_squash * 0.72 + breathe)
	draw_set_transform(pos, mascot_tilt, body_scale)
	# Layered rim, warm underside and speculars give the blob a soft 2.5D jelly volume.
	_draw_local_ellipse(Vector2(0.0, 5.0), 72.0, 54.0, Color("#777762"))
	_draw_local_ellipse(Vector2(0.0, 0.0), 69.0, 51.0, Color("#e8e7ca"))
	_draw_local_ellipse(Vector2(-2.0, -4.0), 64.0, 46.0, Color("#f7f5df"))
	_draw_local_ellipse(Vector2(0.0, 22.0), 53.0, 22.0, Color(0.68, 0.58, 0.36, 0.13))
	_draw_local_ellipse(Vector2(-19.0, -24.0), 27.0, 11.0, Color(1.0, 1.0, 0.94, 0.42))
	_draw_local_ellipse(Vector2(-34.0, -10.0), 8.0, 4.0, Color(1.0, 1.0, 1.0, 0.5))
	_draw_local_ellipse(Vector2(-29.0, 7.0), 8.0, 3.2, Color(1.0, 0.58, 0.66, 0.2))
	_draw_local_ellipse(Vector2(29.0, 7.0), 8.0, 3.2, Color(1.0, 0.58, 0.66, 0.2))

	var look := Vector2(clampf(mascot_velocity.x / MOVE_SPEED, -1.0, 1.0) * 2.2,
		clampf(mascot_velocity.y / MOVE_SPEED, -1.0, 1.0) * 1.5)
	if blink:
		draw_line(Vector2(-22.0, -4.0) + look, Vector2(-13.0, -4.0) + look, Color("#292923"), 2.4, true)
		draw_line(Vector2(13.0, -4.0) + look, Vector2(22.0, -4.0) + look, Color("#292923"), 2.4, true)
	else:
		_draw_local_ellipse(Vector2(-18.0, -5.0) + look, 3.8, 8.5, Color("#262720"))
		_draw_local_ellipse(Vector2(18.0, -5.0) + look, 3.8, 8.5, Color("#262720"))
		_draw_local_ellipse(Vector2(-19.0, -8.0) + look, 1.25, 2.0, Color.WHITE)
		_draw_local_ellipse(Vector2(17.0, -8.0) + look, 1.25, 2.0, Color.WHITE)
	if speed > 0.15:
		_draw_local_ellipse(Vector2(0.0, 12.0), 4.0, 2.2, Color("#c78386"))
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)

func _draw_local_ellipse(center: Vector2, radius_x: float, radius_y: float, color: Color) -> void:
	var points := PackedVector2Array()
	for i in range(33):
		var angle := TAU * float(i) / 32.0
		points.append(center + Vector2(cos(angle) * radius_x, sin(angle) * radius_y))
	draw_colored_polygon(points, color)
