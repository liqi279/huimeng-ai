extends Node2D
## 次元宇宙序章：开启 → 标题粒子上升 → 团子聚合/眨眼 → 落地 → 操作教学。
## 后续游戏逻辑统一在 Godot 4 + GDScript 中扩展。

enum IntroState { WELCOME, TITLE_DISSOLVE, MASCOT_FORM, MASCOT_FALL, PLAYING }

const CYAN := Color(0.25, 0.91, 1.0)
const PURPLE := Color(0.72, 0.39, 1.0)
const PINK := Color(1.0, 0.43, 0.78)
const TITLE_TEXT := "欢迎来到次元宇宙"

var state: IntroState = IntroState.WELCOME
var particles: Array[Dictionary] = []
var elapsed := 0.0
var mascot_position := Vector2(640, -180)
var mascot_velocity := Vector2.ZERO
var blink_timer := 0.0
var blinking := false
var move_input := Vector2.ZERO
var world_time := 0.0
var rng := RandomNumberGenerator.new()

var camera: Camera2D
var title_label: Label
var start_button: Button
var tutorial_panel: PanelContainer

func _ready() -> void:
	rng.randomize()
	camera = Camera2D.new()
	camera.position = Vector2(640, 360)
	camera.position_smoothing_enabled = true
	camera.position_smoothing_speed = 5.0
	add_child(camera)
	camera.make_current()
	_build_ui()

func _build_ui() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	var root := Control.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	layer.add_child(root)

	title_label = Label.new()
	title_label.text = TITLE_TEXT
	title_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title_label.add_theme_font_size_override("font_size", 64)
	title_label.add_theme_color_override("font_color", Color(0.68, 0.88, 1.0))
	title_label.add_theme_color_override("font_shadow_color", Color(0.55, 0.25, 1.0, 0.9))
	title_label.add_theme_constant_override("shadow_offset_x", 4)
	title_label.add_theme_constant_override("shadow_offset_y", 5)
	title_label.add_theme_constant_override("outline_size", 2)
	title_label.add_theme_color_override("font_outline_color", Color(0.15, 0.8, 1.0, 0.9))
	title_label.anchor_left = 0.05
	title_label.anchor_right = 0.95
	title_label.anchor_top = 0.075
	title_label.anchor_bottom = 0.23
	root.add_child(title_label)

	start_button = Button.new()
	start_button.text = "开 启"
	start_button.custom_minimum_size = Vector2(190, 64)
	start_button.add_theme_font_size_override("font_size", 26)
	start_button.add_theme_color_override("font_color", Color(0.82, 0.96, 1.0))
	start_button.add_theme_stylebox_override("normal", _button_style(Color(0.04, 0.13, 0.24, 0.92), CYAN))
	start_button.add_theme_stylebox_override("hover", _button_style(Color(0.08, 0.2, 0.34, 1), PURPLE))
	start_button.add_theme_stylebox_override("pressed", _button_style(Color(0.12, 0.08, 0.28, 1), PINK))
	start_button.anchor_left = 0.5
	start_button.anchor_right = 0.5
	start_button.anchor_top = 0.52
	start_button.anchor_bottom = 0.52
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
	tutorial_panel.offset_left = -310
	tutorial_panel.offset_right = -24
	tutorial_panel.offset_top = 0
	tutorial_panel.offset_bottom = 190
	var panel_style := StyleBoxFlat.new()
	panel_style.bg_color = Color(0.025, 0.06, 0.13, 0.9)
	panel_style.border_color = Color(0.2, 0.83, 1.0, 0.85)
	panel_style.set_border_width_all(1)
	panel_style.set_corner_radius_all(10)
	panel_style.shadow_color = Color(0.1, 0.65, 1.0, 0.28)
	panel_style.shadow_size = 12
	tutorial_panel.add_theme_stylebox_override("panel", panel_style)
	root.add_child(tutorial_panel)

	var tutorial_box := VBoxContainer.new()
	tutorial_box.add_theme_constant_override("separation", 9)
	tutorial_panel.add_child(tutorial_box)
	var tutorial_title := Label.new()
	tutorial_title.text = "新手引导  /  MOVEMENT"
	tutorial_title.add_theme_font_size_override("font_size", 17)
	tutorial_title.add_theme_color_override("font_color", CYAN)
	tutorial_box.add_child(tutorial_title)
	for line in ["W A S D / 方向键：移动团子", "鼠标左键拖动：调整观察视角", "滚轮：缩放视野", "探索这个次元空间吧！"]:
		var label := Label.new()
		label.text = line
		label.add_theme_font_size_override("font_size", 14)
		label.add_theme_color_override("font_color", Color(0.8, 0.88, 1.0))
		tutorial_box.add_child(label)

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
	button_tween.tween_property(start_button, "modulate:a", 0.0, 0.22)
	button_tween.tween_property(start_button, "scale", Vector2(0.65, 0.65), 0.22)
	button_tween.chain().tween_callback(func() -> void: start_button.visible = false)
	_create_title_particles()
	var title_tween := create_tween()
	title_tween.tween_property(title_label, "modulate:a", 0.0, 0.12)

func _create_title_particles() -> void:
	particles.clear()
	var origin := Rect2(70, 75, 1140, 125)
	for y in range(0, 10):
		for x in range(0, 96):
			if rng.randf() > 0.55:
				continue
			var point := Vector2(
				origin.position.x + float(x) / 96.0 * origin.size.x + rng.randf_range(-4, 4),
				origin.position.y + float(y) / 10.0 * origin.size.y + rng.randf_range(-4, 4)
			)
			var angle := rng.randf_range(0.0, TAU)
			var target := Vector2(640 + cos(angle) * rng.randf_range(8.0, 62.0), 158 + sin(angle) * rng.randf_range(8.0, 42.0))
			particles.append({
				"pos": point, "start": point, "target": target,
				"delay": rng.randf_range(0.0, 0.42),
				"size": rng.randf_range(1.2, 3.3),
				"color": [CYAN, PURPLE, PINK, Color(0.8, 0.94, 1.0)][rng.randi_range(0, 3)]
			})

func _process(delta: float) -> void:
	world_time += delta
	elapsed += delta
	match state:
		IntroState.TITLE_DISSOLVE:
			_update_title_particles()
			if elapsed > 1.85:
				state = IntroState.MASCOT_FORM
				elapsed = 0.0
		IntroState.MASCOT_FORM:
			_update_title_particles()
			if elapsed > 0.82:
				particles.clear()
				state = IntroState.MASCOT_FALL
				elapsed = 0.0
				mascot_position = Vector2(640, 150)
				mascot_velocity = Vector2(0, 40)
				blinking = true
				blink_timer = 0.22
		IntroState.MASCOT_FALL:
			mascot_velocity.y += 1450.0 * delta
			mascot_position += mascot_velocity * delta
			if mascot_position.y >= 548:
				mascot_position.y = 548
				mascot_velocity.y = -mascot_velocity.y * 0.22
				if absf(mascot_velocity.y) < 95:
					mascot_velocity = Vector2.ZERO
					state = IntroState.PLAYING
					elapsed = 0.0
					tutorial_panel.visible = true
					tutorial_panel.modulate.a = 0.0
					create_tween().tween_property(tutorial_panel, "modulate:a", 1.0, 0.35)
		IntroState.PLAYING:
			_update_player(delta)
	_update_blink(delta)
	queue_redraw()

func _update_title_particles() -> void:
	for p in particles:
		var t := clampf((elapsed - float(p["delay"])) / 1.2, 0.0, 1.0)
		var eased := 1.0 - pow(1.0 - t, 3.0)
		p["pos"] = (p["start"] as Vector2).lerp(p["target"] as Vector2, eased)
		if state == IntroState.MASCOT_FORM:
			var target: Vector2 = p["target"]
			p["pos"] = target + Vector2(sin(elapsed * 8.0 + target.x * 0.04) * 2.0, 0)

func _update_blink(delta: float) -> void:
	if blinking:
		blink_timer -= delta
		if blink_timer <= 0.0:
			blinking = false

func _update_player(delta: float) -> void:
	move_input = Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
	if Input.is_key_pressed(KEY_A): move_input.x -= 1.0
	if Input.is_key_pressed(KEY_D): move_input.x += 1.0
	if Input.is_key_pressed(KEY_W): move_input.y -= 1.0
	if Input.is_key_pressed(KEY_S): move_input.y += 1.0
	move_input = move_input.normalized()
	mascot_position += move_input * 260.0 * delta
	mascot_position.x = clampf(mascot_position.x, 80.0, 1200.0)
	mascot_position.y = clampf(mascot_position.y, 180.0, 548.0)
	camera.position = camera.position.lerp(Vector2(640, 360) + (mascot_position - Vector2(640, 548)) * 0.18, delta * 2.0)

func _unhandled_input(event: InputEvent) -> void:
	if state != IntroState.PLAYING:
		return
	if event is InputEventMouseMotion and Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT):
		camera.position.x -= event.relative.x * 0.45
		camera.position.y -= event.relative.y * 0.35
	if event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			camera.zoom = (camera.zoom * 1.08).clamp(Vector2(0.65, 0.65), Vector2(1.5, 1.5))
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			camera.zoom = (camera.zoom / 1.08).clamp(Vector2(0.65, 0.65), Vector2(1.5, 1.5))

func _draw() -> void:
	_draw_cyber_world()
	for p in particles:
		var pos: Vector2 = p["pos"]
		var color: Color = p["color"]
		draw_circle(pos, float(p["size"]) * 2.6, Color(color.r, color.g, color.b, 0.16))
		draw_circle(pos, float(p["size"]), color)
	if state in [IntroState.MASCOT_FORM, IntroState.MASCOT_FALL, IntroState.PLAYING]:
		_draw_mascot(mascot_position)

func _draw_cyber_world() -> void:
	draw_rect(Rect2(Vector2(-2000, -2000), Vector2(5000, 5000)), Color(0.025, 0.035, 0.09))
	var grid_color := Color(0.12, 0.32, 0.48, 0.22)
	for x in range(-2000, 3201, 64):
		draw_line(Vector2(x, -2000), Vector2(x, 3000), grid_color, 1.0)
	for y in range(-2000, 3001, 64):
		draw_line(Vector2(-2000, y), Vector2(3200, y), grid_color, 1.0)
	for i in range(80):
		var sx := fposmod(float(i * 173), 1280.0)
		var sy := fposmod(float(i * 89), 720.0)
		var twinkle := 0.35 + 0.25 * sin(world_time * 1.6 + float(i))
		draw_circle(Vector2(sx, sy), 1.0, Color(0.35, 0.85, 1.0, twinkle))
	draw_line(Vector2(-2000, 620), Vector2(3200, 620), Color(0.12, 0.82, 1.0, 0.55), 2.0)
	for i in range(20):
		var x := float(i) * 80.0 - 400.0
		draw_line(Vector2(x, 620), Vector2(x - 50, 720), Color(0.2, 0.75, 1.0, 0.16), 1.0)

func _draw_mascot(pos: Vector2) -> void:
	draw_set_transform(pos, 0.0, Vector2.ONE)
	var points := PackedVector2Array()
	for i in range(65):
		var a := TAU * float(i) / 64.0
		points.append(Vector2(cos(a) * 62.0, 10.0 + sin(a) * 47.0))
	draw_colored_polygon(points, Color(0.9, 0.94, 0.84, 0.97))
	for i in range(points.size() - 1):
		draw_line(points[i], points[i + 1], Color(0.72, 0.75, 0.64, 0.9), 3.0)
	if blinking:
		draw_line(Vector2(-22, 0), Vector2(-8, 0), Color(0.12, 0.13, 0.12), 3.0)
		draw_line(Vector2(8, 0), Vector2(22, 0), Color(0.12, 0.13, 0.12), 3.0)
	else:
		draw_line(Vector2(-15, -8), Vector2(-15, 7), Color(0.12, 0.13, 0.12), 3.0)
		draw_line(Vector2(15, -8), Vector2(15, 7), Color(0.12, 0.13, 0.12), 3.0)
	draw_set_transform(Vector2.ZERO)
