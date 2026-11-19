extends Node2D
## Godot 4 次元宇宙序章与可操作的 2D 游戏原型。
## UI/游戏状态/角色物理均由 Godot 管理；网页仅承载 Web 导出。

enum IntroState { WELCOME, TITLE_DISSOLVE, MASCOT_FORM, MASCOT_FALL, PLAYING }

const VIEW_SIZE := Vector2(1280.0, 720.0)
const TITLE_TEXT := "欢迎来到次元宇宙"
const CYAN := Color("#67eaff")
const BLUE := Color("#8bdcff")
const PINK := Color("#e58cff")
const PURPLE := Color("#a86cff")
const FLOOR_Y := 620.0
const PLAYER_SPEED := 270.0
const GRAVITY := 1500.0

var state: IntroState = IntroState.WELCOME
var rng := RandomNumberGenerator.new()
var elapsed := 0.0
var world_time := 0.0
var particles: Array[Dictionary] = []
var title_nodes: Array[Control] = []
var blinking := false
var blink_timer := 0.0
var blink_cooldown := 1.7
var drag_camera := false
var score := 0
var crystals: Array[Vector2] = [Vector2(260, 520), Vector2(520, 450), Vector2(900, 510), Vector2(1090, 390)]

var camera: Camera2D
var player: CharacterBody2D
var tutorial_panel: PanelContainer
var title_layer: Control
var start_button: Button
var score_label: Label
var hint_label: Label

func _ready() -> void:
	rng.randomize()
	_build_world()
	_build_ui()
	queue_redraw()

func _build_world() -> void:
	camera = Camera2D.new()
	camera.position = VIEW_SIZE * 0.5
	camera.position_smoothing_enabled = true
	camera.position_smoothing_speed = 7.0
	add_child(camera)
	camera.make_current()

	var floor_body := StaticBody2D.new()
	floor_body.position = Vector2(640, FLOOR_Y + 34)
	var floor_shape := CollisionShape2D.new()
	var floor_rect := RectangleShape2D.new()
	floor_rect.size = Vector2(1800, 70)
	floor_shape.shape = floor_rect
	floor_body.add_child(floor_shape)
	add_child(floor_body)

	player = CharacterBody2D.new()
	player.position = Vector2(640, -180)
	player.floor_snap_length = 8.0
	var body_shape := CollisionShape2D.new()
	var capsule := CapsuleShape2D.new()
	capsule.radius = 42.0
	capsule.height = 104.0
	body_shape.shape = capsule
	player.add_child(body_shape)
	add_child(player)

func _build_ui() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	var root := Control.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	layer.add_child(root)

	title_layer = Control.new()
	title_layer.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.add_child(title_layer)
	_build_3d_gradient_title()

	start_button = Button.new()
	start_button.text = "开 启"
	start_button.custom_minimum_size = Vector2(190, 64)
	start_button.add_theme_font_size_override("font_size", 26)
	start_button.add_theme_color_override("font_color", Color("#d9faff"))
	start_button.add_theme_stylebox_override("normal", _button_style(Color(0.035, 0.10, 0.22, 0.94), CYAN))
	start_button.add_theme_stylebox_override("hover", _button_style(Color(0.08, 0.13, 0.31, 1.0), PURPLE))
	start_button.add_theme_stylebox_override("pressed", _button_style(Color(0.13, 0.07, 0.25, 1.0), PINK))
	start_button.anchor_left = 0.5
	start_button.anchor_right = 0.5
	start_button.anchor_top = 0.58
	start_button.anchor_bottom = 0.58
	start_button.offset_left = -95
	start_button.offset_right = 95
	start_button.offset_top = -32
	start_button.offset_bottom = 32
	root.add_child(start_button)
	start_button.pressed.connect(_on_start_pressed)

	tutorial_panel = PanelContainer.new()
	tutorial_panel.visible = false
	tutorial_panel.anchor_left = 1.0
	tutorial_panel.anchor_right = 1.0
	tutorial_panel.anchor_top = 0.035
	tutorial_panel.anchor_bottom = 0.035
	tutorial_panel.offset_left = -326
	tutorial_panel.offset_right = -24
	tutorial_panel.offset_top = 0
	tutorial_panel.offset_bottom = 205
	var panel_style := StyleBoxFlat.new()
	panel_style.bg_color = Color(0.018, 0.045, 0.105, 0.94)
	panel_style.border_color = Color(0.2, 0.82, 1.0, 0.9)
	panel_style.set_border_width_all(1)
	panel_style.set_corner_radius_all(10)
	panel_style.shadow_color = Color(0.1, 0.65, 1.0, 0.25)
	panel_style.shadow_size = 12
	tutorial_panel.add_theme_stylebox_override("panel", panel_style)
	root.add_child(tutorial_panel)

	var tutorial_box := VBoxContainer.new()
	tutorial_box.add_theme_constant_override("separation", 8)
	tutorial_panel.add_child(tutorial_box)
	var tutorial_title := Label.new()
	tutorial_title.text = "次元探索指南  /  CONTROLS"
	tutorial_title.add_theme_font_size_override("font_size", 17)
	tutorial_title.add_theme_color_override("font_color", CYAN)
	tutorial_box.add_child(tutorial_title)
	for line in ["W A S D / 方向键：移动团子", "鼠标左键拖动：观察周围", "滚轮：缩放视野", "收集场景中的能量晶体"]:
		var label := Label.new()
		label.text = line
		label.add_theme_font_size_override("font_size", 14)
		label.add_theme_color_override("font_color", Color("#d5e8ff"))
		tutorial_box.add_child(label)

	score_label = Label.new()
	score_label.position = Vector2(26, 24)
	score_label.add_theme_font_size_override("font_size", 20)
	score_label.add_theme_color_override("font_color", CYAN)
	score_label.visible = false
	root.add_child(score_label)

	hint_label = Label.new()
	hint_label.text = "收集能量晶体，探索次元空间"
	hint_label.position = Vector2(26, 58)
	hint_label.add_theme_font_size_override("font_size", 14)
	hint_label.add_theme_color_override("font_color", Color(0.72, 0.82, 1.0, 0.85))
	hint_label.visible = false
	root.add_child(hint_label)

func _build_3d_gradient_title() -> void:
	var font := ThemeDB.fallback_font
	var font_size := 64
	var total_width := font.get_string_size(TITLE_TEXT, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size).x
	var cursor_x := (VIEW_SIZE.x - total_width) * 0.5
	var title_y := 286.0
	for i in range(TITLE_TEXT.length()):
		var character := TITLE_TEXT.substr(i, 1)
		var char_width := font.get_string_size(character, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size).x
		var t := float(i) / maxf(1.0, float(TITLE_TEXT.length() - 1))
		var face_color := CYAN.lerp(PINK, t)
		for depth in range(5, 0, -1):
			var extrusion := Label.new()
			extrusion.text = character
			extrusion.position = Vector2(cursor_x + depth * 1.4, title_y + depth * 1.5)
			extrusion.size = Vector2(char_width + 8, 100)
			extrusion.add_theme_font_size_override("font_size", font_size)
			extrusion.add_theme_color_override("font_color", Color(0.30, 0.10, 0.55, 0.92 - depth * 0.08))
			title_layer.add_child(extrusion)
			title_nodes.append(extrusion)
		var face := Label.new()
		face.text = character
		face.position = Vector2(cursor_x, title_y)
		face.size = Vector2(char_width + 8, 100)
		face.add_theme_font_size_override("font_size", font_size)
		face.add_theme_color_override("font_color", face_color)
		face.add_theme_color_override("font_outline_color", Color("#d8faff"))
		face.add_theme_constant_override("outline_size", 2)
		face.add_theme_color_override("font_shadow_color", Color(0.35, 0.05, 0.6, 0.9))
		face.add_theme_constant_override("shadow_offset_x", 3)
		face.add_theme_constant_override("shadow_offset_y", 4)
		title_layer.add_child(face)
		title_nodes.append(face)
		cursor_x += char_width

func _button_style(fill: Color, accent: Color) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = fill
	style.border_color = accent
	style.set_border_width_all(2)
	style.set_corner_radius_all(8)
	style.shadow_color = Color(accent.r, accent.g, accent.b, 0.35)
	style.shadow_size = 14
	return style

func _on_start_pressed() -> void:
	if state != IntroState.WELCOME:
		return
	state = IntroState.TITLE_DISSOLVE
	elapsed = 0.0
	start_button.disabled = true
	var button_tween := create_tween()
	button_tween.set_parallel(true)
	button_tween.tween_property(start_button, "modulate:a", 0.0, 0.2)
	button_tween.tween_property(start_button, "scale", Vector2(0.55, 0.55), 0.2)
	button_tween.chain().tween_callback(func() -> void: start_button.visible = false)
	_build_title_particles()
	for node in title_nodes:
		node.visible = false

func _build_title_particles() -> void:
	particles.clear()
	var mask_viewport := SubViewport.new()
	mask_viewport.size = Vector2i(1280, 720)
	mask_viewport.transparent_bg = true
	mask_viewport.render_target_update_mode = SubViewport.UPDATE_ONCE
	add_child(mask_viewport)
	for node in title_nodes:
		var sample_label := Label.new()
		sample_label.text = (node as Label).text
		sample_label.position = (node as Label).position
		sample_label.size = (node as Label).size
		sample_label.add_theme_font_size_override("font_size", 64)
		sample_label.add_theme_color_override("font_color", Color.WHITE)
		sample_label.add_theme_constant_override("outline_size", 0)
		mask_viewport.add_child(sample_label)
	await RenderingServer.frame_post_draw
	var mask_image := mask_viewport.get_texture().get_image()
	if mask_image != null:
		for y in range(280, 395, 3):
			for x in range(120, 1160, 3):
				var pixel := mask_image.get_pixel(x, y)
				if pixel.a < 0.35 or rng.randf() > 0.72:
					continue
				var start := Vector2(x, y)
				var angle := rng.randf_range(0.0, TAU)
				var radius_x := rng.randf_range(10.0, 78.0)
				var radius_y := rng.randf_range(8.0, 54.0)
				var target := Vector2(640 + cos(angle) * radius_x, 190 + sin(angle) * radius_y)
				var gradient_t := clampf(float(x - 120) / 1040.0, 0.0, 1.0)
				particles.append({
					"pos": start, "start": start, "target": target,
					"delay": rng.randf_range(0.0, 0.48),
					"size": rng.randf_range(1.0, 2.8),
					"color": CYAN.lerp(PINK, gradient_t)
				})
	mask_viewport.queue_free()
	if particles.is_empty():
		# 极端浏览器/渲染环境下的兜底：仍按标题排布生成密集点阵，不会出现空动画。
		for y in range(292, 380, 5):
			for x in range(250, 1030, 5):
				var start := Vector2(x, y)
				var angle := rng.randf_range(0.0, TAU)
				particles.append({"pos": start, "start": start,
					"target": Vector2(640 + cos(angle) * 50, 190 + sin(angle) * 36),
					"delay": rng.randf_range(0.0, 0.4), "size": 1.8,
					"color": CYAN.lerp(PINK, float(x - 250) / 780.0)})

func _process(delta: float) -> void:
	world_time += delta
	elapsed += delta
	match state:
		IntroState.TITLE_DISSOLVE:
			_update_title_particles()
			if elapsed > 1.9:
				state = IntroState.MASCOT_FORM
				elapsed = 0.0
		IntroState.MASCOT_FORM:
			_update_title_particles()
			if elapsed > 0.95:
				particles.clear()
				state = IntroState.MASCOT_FALL
				elapsed = 0.0
				player.position = Vector2(640, 145)
				player.velocity = Vector2(0, 80)
				blinking = true
				blink_timer = 0.24
		IntroState.MASCOT_FALL:
			_step_player_physics(delta, false)
			if player.is_on_floor():
				player.velocity.x = 0.0
				state = IntroState.PLAYING
				elapsed = 0.0
				tutorial_panel.visible = true
				tutorial_panel.modulate.a = 0.0
				create_tween().tween_property(tutorial_panel, "modulate:a", 1.0, 0.4)
				score_label.visible = true
				hint_label.visible = true
				_update_score_ui()
		IntroState.PLAYING:
			_step_player_physics(delta, true)
			_check_crystal_collection()
			_update_camera(delta)
	_update_blink(delta)
	queue_redraw()

func _update_title_particles() -> void:
	for particle in particles:
		var t := clampf((elapsed - float(particle["delay"])) / 1.25, 0.0, 1.0)
		var eased := 1.0 - pow(1.0 - t, 3.0)
		particle["pos"] = (particle["start"] as Vector2).lerp(particle["target"] as Vector2, eased)
		if state == IntroState.MASCOT_FORM:
			var target: Vector2 = particle["target"]
			particle["pos"] = target + Vector2(sin(elapsed * 7.0 + target.x * 0.04) * 2.0, 0.0)

func _step_player_physics(delta: float, allow_input: bool) -> void:
	if allow_input:
		var direction := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
		if Input.is_key_pressed(KEY_A): direction.x -= 1.0
		if Input.is_key_pressed(KEY_D): direction.x += 1.0
		direction = direction.normalized()
		player.velocity.x = direction.x * PLAYER_SPEED
	else:
		player.velocity.x = move_toward(player.velocity.x, 0.0, 900.0 * delta)
	player.velocity.y += GRAVITY * delta
	player.move_and_slide()
	player.position.x = clampf(player.position.x, 48.0, 1232.0)

func _update_camera(delta: float) -> void:
	var target := Vector2(player.position.x, 360.0)
	camera.position = camera.position.lerp(target, minf(1.0, delta * 3.5))

func _check_crystal_collection() -> void:
	for i in range(crystals.size() - 1, -1, -1):
		if player.position.distance_to(crystals[i]) < 66.0:
			crystals.remove_at(i)
			score += 1
			_update_score_ui()

func _update_score_ui() -> void:
	score_label.text = "能量晶体  %02d / 04" % score
	if score >= 4:
		hint_label.text = "收集完成！次元通道已激活"
	else:
		hint_label.text = "靠近发光晶体即可收集"

func _update_blink(delta: float) -> void:
	if blinking:
		blink_timer -= delta
		if blink_timer <= 0.0:
			blinking = false
			blink_cooldown = rng.randf_range(2.0, 4.0)
	else:
		blink_cooldown -= delta
		if blink_cooldown <= 0.0 and state == IntroState.PLAYING:
			blinking = true
			blink_timer = 0.16

func _unhandled_input(event: InputEvent) -> void:
	if state != IntroState.PLAYING:
		return
	if event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_LEFT:
			drag_camera = event.pressed
		elif event.pressed and event.button_index == MOUSE_BUTTON_WHEEL_UP:
			camera.zoom = (camera.zoom * 1.08).clamp(Vector2(0.65, 0.65), Vector2(1.5, 1.5))
		elif event.pressed and event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			camera.zoom = (camera.zoom / 1.08).clamp(Vector2(0.65, 0.65), Vector2(1.5, 1.5))
	elif event is InputEventMouseMotion and drag_camera:
		camera.position -= event.relative / camera.zoom.x

func _draw() -> void:
	_draw_cyber_world()
	for crystal in crystals:
		var pulse := 1.0 + 0.15 * sin(world_time * 3.0 + crystal.x)
		draw_circle(crystal, 15.0 * pulse, Color(0.1, 0.85, 1.0, 0.13))
		draw_colored_polygon(PackedVector2Array([
			crystal + Vector2(0, -10), crystal + Vector2(9, 0),
			crystal + Vector2(0, 10), crystal + Vector2(-9, 0)
		]), CYAN)
	for particle in particles:
		var pos: Vector2 = particle["pos"]
		var color: Color = particle["color"]
		draw_circle(pos, float(particle["size"]) * 2.7, Color(color.r, color.g, color.b, 0.18))
		draw_circle(pos, float(particle["size"]), color)
	if state in [IntroState.MASCOT_FALL, IntroState.PLAYING]:
		_draw_mascot(player.position)

func _draw_cyber_world() -> void:
	draw_rect(Rect2(Vector2(-2000, -2000), Vector2(6000, 5000)), Color("#08091d"))
	var grid_color := Color(0.12, 0.32, 0.48, 0.22)
	for x in range(-2000, 4001, 64):
		draw_line(Vector2(x, -2000), Vector2(x, 3000), grid_color, 1.0)
	for y in range(-2000, 3001, 64):
		draw_line(Vector2(-2000, y), Vector2(4000, y), grid_color, 1.0)
	for i in range(95):
		var sx := fposmod(float(i * 173), 1280.0)
		var sy := fposmod(float(i * 89), 720.0)
		var twinkle := 0.32 + 0.28 * sin(world_time * 1.6 + float(i))
		draw_circle(Vector2(sx, sy), 1.2, Color(0.35, 0.85, 1.0, twinkle))
	draw_line(Vector2(-2000, FLOOR_Y), Vector2(4000, FLOOR_Y), Color(0.12, 0.82, 1.0, 0.65), 2.0)
	for i in range(28):
		var x := float(i) * 80.0 - 400.0
		draw_line(Vector2(x, FLOOR_Y), Vector2(x - 50, 720), Color(0.2, 0.75, 1.0, 0.16), 1.0)

func _draw_mascot(pos: Vector2) -> void:
	var points := PackedVector2Array()
	for i in range(65):
		var angle := TAU * float(i) / 64.0
		points.append(pos + Vector2(cos(angle) * 62.0, 10.0 + sin(angle) * 47.0))
	draw_colored_polygon(points, Color("#f3f2d9"))
	for i in range(points.size() - 1):
		draw_line(points[i], points[i + 1], Color("#a9aa91"), 3.0)
	if blinking:
		draw_line(pos + Vector2(-22, 0), pos + Vector2(-8, 0), Color("#171717"), 3.0)
		draw_line(pos + Vector2(8, 0), pos + Vector2(22, 0), Color("#171717"), 3.0)
	else:
		draw_line(pos + Vector2(-15, -8), pos + Vector2(-15, 7), Color("#171717"), 3.0)
		draw_line(pos + Vector2(15, -8), pos + Vector2(15, 7), Color("#171717"), 3.0)
