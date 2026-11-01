/* ============================================================
 * 工作流 HMTOOLWORKFLOW
 * 在【工具】模块下提供「工作流」卡片：内置多个 ComfyUI 工作流，
 * 切换工作流 → 可视化编辑参数 → 导出可直接导入 ComfyUI 的 JSON。
 * 纯前端：不运行 ComfyUI，仅做参数编辑 + 工作流 JSON 导出。
 * ============================================================ */
window.HMToolWorkflow = (function () {
  'use strict';

  var LS_PREFIX = 'anidream.workflow.';

  /* ---------- 内置工作流 JSON（千问3 TTS 语音克隆） ---------- */
  var QWEN3_VOICE_CLONE = {
    "last_link_id": 17,
    "nodes": [
      {
        "outputs": [{ "name": "音频", "links": [14], "label": "音频", "type": "AUDIO", "localized_name": "音频" }],
        "color": "#2a363b",
        "widgets_values": ["Hello, this is a test.", "A young female voice, energetic and bright.", "中文", false, 2048, 0, "固定", 1, false, 0.8, 50, 0.8, 1.1, false],
        "inputs": [
          { "name": "模型", "link": 11, "label": "模型", "type": "QWEN3_TTS_MODEL", "localized_name": "模型" },
          { "widget": { "name": "文本" }, "name": "文本", "link": 12, "label": "文本", "type": "STRING", "localized_name": "文本" },
          { "widget": { "name": "提示词" }, "name": "提示词", "link": 13, "label": "提示词", "type": "STRING", "localized_name": "提示词" },
          { "widget": { "name": "语言" }, "name": "语言", "label": "语言", "type": "COMBO", "localized_name": "语言" },
          { "widget": { "name": "自动卸载模型" }, "name": "自动卸载模型", "label": "自动卸载模型", "type": "BOOLEAN", "localized_name": "自动卸载模型" },
          { "widget": { "name": "最大生成Token数" }, "name": "最大生成Token数", "label": "最大生成Token数", "type": "INT", "localized_name": "最大生成Token数" },
          { "widget": { "name": "seed" }, "name": "seed", "label": "seed", "type": "INT", "localized_name": "seed" },
          { "widget": { "name": "语速" }, "name": "语速", "label": "语速", "type": "FLOAT", "localized_name": "语速" },
          { "widget": { "name": "批量模式" }, "shape": 7, "name": "批量模式", "label": "批量模式", "type": "BOOLEAN", "localized_name": "批量模式" },
          { "widget": { "name": "top_p" }, "shape": 7, "name": "top_p", "label": "top_p", "type": "FLOAT", "localized_name": "top_p" },
          { "widget": { "name": "top_k" }, "shape": 7, "name": "top_k", "label": "top_k", "type": "INT", "localized_name": "top_k" },
          { "widget": { "name": "temperature" }, "shape": 7, "name": "temperature", "label": "temperature", "type": "FLOAT", "localized_name": "temperature" },
          { "widget": { "name": "repetition_penalty" }, "shape": 7, "name": "repetition_penalty", "label": "repetition_penalty", "type": "FLOAT", "localized_name": "repetition_penalty" },
          { "widget": { "name": "启用高级采样配置" }, "shape": 7, "name": "启用高级采样配置", "label": "启用高级采样配置", "type": "BOOLEAN", "localized_name": "启用高级采样配置" }
        ],
        "flags": {},
        "type": "Qwen3TTSVoiceDesign",
        "mode": 0,
        "size": [400, 430],
        "pos": [435.15948486328125, 318.5373840332031],
        "id": 12,
        "properties": { "widget_ue_connectable": {}, "Node name for S&R": "Qwen3TTSVoiceDesign" },
        "order": 9,
        "widgets_values_named": { "语言": "中文", "语速": 1, "seed": 0, "提示词": "A young female voice, energetic and bright.", "文本": "Hello, this is a test.", "最大生成Token数": 2048, "control_after_generate": "固定", "top_p": 0.8, "批量模式": false, "top_k": 50, "temperature": 0.8, "自动卸载模型": false, "启用高级采样配置": false, "repetition_penalty": 1.1 }
      },
      {
        "outputs": [{ "name": "STRING", "links": [9], "label": "STRING", "type": "STRING", "localized_name": "STRING" }],
        "color": "#2a363b",
        "shape": 1,
        "widgets_values": ["large", "auto"],
        "inputs": [
          { "name": "audio", "link": 8, "label": "audio", "type": "AUDIO", "localized_name": "audio" },
          { "widget": { "name": "model_size" }, "name": "model_size", "label": "model_size", "type": "COMBO", "localized_name": "model_size" },
          { "widget": { "name": "language" }, "name": "language", "label": "language", "type": "COMBO", "localized_name": "language" }
        ],
        "flags": {},
        "type": "WhisperSTT",
        "mode": 0,
        "size": [270, 82],
        "pos": [1910.748046875, 98.01587677001953],
        "id": 10,
        "properties": { "widget_ue_connectable": {}, "Node name for S&R": "WhisperSTT" },
        "order": 13,
        "widgets_values_named": { "language": "auto", "model_size": "large" }
      },
      {
        "outputs": [{ "name": "模型", "links": [1], "label": "模型", "type": "QWEN3_TTS_MODEL", "localized_name": "模型" }],
        "color": "#2a363b",
        "widgets_values": ["Qwen/Qwen3-TTS-12Hz-1.7B-Base", "cuda", "fp16"],
        "inputs": [
          { "widget": { "name": "模型名称" }, "name": "模型名称", "label": "模型名称", "type": "COMBO", "localized_name": "模型名称" },
          { "widget": { "name": "运行设备" }, "name": "运行设备", "label": "运行设备", "type": "COMBO", "localized_name": "运行设备" },
          { "widget": { "name": "精度" }, "name": "精度", "label": "精度", "type": "COMBO", "localized_name": "精度" }
        ],
        "flags": {},
        "type": "Qwen3TTSModelLoader",
        "mode": 0,
        "size": [377.2331237792969, 106],
        "pos": [1162.841796875, 591.0463256835938],
        "id": 2,
        "properties": { "widget_ue_connectable": {}, "Node name for S&R": "Qwen3TTSModelLoader" },
        "order": 1,
        "widgets_values_named": { "运行设备": "cuda", "精度": "fp16", "模型名称": "Qwen/Qwen3-TTS-12Hz-1.7B-Base" }
      },
      {
        "outputs": [],
        "color": "#432",
        "widgets_values": [""],
        "inputs": [],
        "flags": {},
        "type": "MarkdownNote",
        "mode": 4,
        "bgcolor": "#653",
        "size": [257.5350036621094, 88],
        "pos": [-12.137606620788574, 370.53399658203125],
        "id": 16,
        "properties": { "widget_ue_connectable": {} },
        "order": 2,
        "widgets_values_named": { "text": "# 描述说话的语气，情景等" }
      },
      {
        "outputs": [{ "name": "audio", "label": "audio", "type": "AUDIO", "localized_name": "audio" }],
        "color": "#2a363b",
        "widgets_values": ["audio/ComfyUI"],
        "inputs": [
          { "name": "audio", "link": 14, "label": "audio", "type": "AUDIO", "localized_name": "audio" },
          { "widget": { "name": "filename_prefix" }, "name": "filename_prefix", "label": "filename_prefix", "type": "STRING", "localized_name": "filename_prefix" },
          { "widget": { "name": "audioUI" }, "name": "audioUI", "label": "audioUI", "type": "AUDIO_UI", "localized_name": "audioUI" }
        ],
        "flags": {},
        "type": "SaveAudio",
        "mode": 0,
        "size": [270.1958984375, 112],
        "pos": [859.7811279296875, 318.8221435546875],
        "id": 17,
        "properties": { "widget_ue_connectable": {}, "Node name for S&R": "SaveAudio" },
        "order": 11,
        "widgets_values_named": { "filename_prefix": "audio/ComfyUI" }
      },
      {
        "outputs": [{ "name": "audio", "label": "audio", "type": "AUDIO", "localized_name": "audio" }],
        "color": "#2a363b",
        "widgets_values": [],
        "inputs": [
          { "name": "audio", "link": 7, "label": "audio", "type": "AUDIO", "localized_name": "audio" },
          { "widget": { "name": "audioUI" }, "name": "audioUI", "label": "audioUI", "type": "AUDIO_UI", "localized_name": "audioUI" }
        ],
        "flags": {},
        "type": "PreviewAudio",
        "mode": 0,
        "size": [270, 88],
        "pos": [1605.0618896484375, 577.593994140625],
        "id": 9,
        "properties": { "widget_ue_connectable": {}, "Node name for S&R": "PreviewAudio" },
        "order": 12,
        "widgets_values_named": {}
      },
      {
        "outputs": [{ "name": "AUDIO", "links": [5, 7, 8], "label": "AUDIO", "type": "AUDIO", "localized_name": "AUDIO" }],
        "color": "#232",
        "shape": 1,
        "widgets_values": ["0:00", "0:4"],
        "inputs": [
          { "name": "audio", "link": 4, "label": "audio", "type": "AUDIO", "localized_name": "audio" },
          { "widget": { "name": "start_time" }, "name": "start_time", "label": "start_time", "type": "STRING", "localized_name": "start_time" },
          { "widget": { "name": "end_time" }, "name": "end_time", "label": "end_time", "type": "STRING", "localized_name": "end_time" }
        ],
        "flags": {},
        "type": "AudioCrop",
        "mode": 0,
        "size": [303.3451843261719, 141.33248901367188],
        "pos": [1171.7012939453125, 386.5920715332031],
        "id": 6,
        "properties": { "cnr_id": "audio-separation-nodes-comfyui", "ver": "31a4567726e035097cc2d1f767767908a6fda2ea", "widget_ue_connectable": {}, "Node name for S&R": "AudioCrop" },
        "order": 10,
        "widgets_values_named": { "start_time": "0:00", "end_time": "0:4" }
      },
      {
        "outputs": [{ "name": "audio", "label": "audio", "type": "AUDIO", "localized_name": "audio" }],
        "color": "#232",
        "widgets_values": ["audio/ComfyUI"],
        "inputs": [
          { "name": "audio", "link": 2, "label": "audio", "type": "AUDIO", "localized_name": "audio" },
          { "widget": { "name": "filename_prefix" }, "name": "filename_prefix", "label": "filename_prefix", "type": "STRING", "localized_name": "filename_prefix" },
          { "widget": { "name": "audioUI" }, "name": "audioUI", "label": "audioUI", "type": "AUDIO_UI", "localized_name": "audioUI" }
        ],
        "flags": {},
        "type": "SaveAudio",
        "mode": 0,
        "size": [270.1958984375, 112],
        "pos": [2304.173095703125, 234.21766662597656],
        "id": 3,
        "properties": { "widget_ue_connectable": {}, "Node name for S&R": "SaveAudio" },
        "order": 15,
        "widgets_values_named": { "filename_prefix": "audio/ComfyUI" }
      },
      {
        "outputs": [
          { "name": "text", "links": [12], "label": "text", "type": "*", "localized_name": "text" },
          { "name": "show_help", "label": "show_help", "type": "STRING", "localized_name": "show_help" }
        ],
        "color": "#232",
        "widgets_values": ["能把二十五班带起来，确实厉害，不过……水平这么高的老师，七班家长为什么要换走？"],
        "inputs": [{ "widget": { "name": "text" }, "name": "text", "label": "text", "type": "STRING", "localized_name": "text" }],
        "flags": {},
        "type": "CR Text",
        "mode": 0,
        "size": [393.2381591796875, 263.1104431152344],
        "pos": [-9.570901870727539, 58.26057052612305],
        "id": 14,
        "properties": { "widget_ue_connectable": {}, "Node name for S&R": "CR Text" },
        "order": 3,
        "widgets_values_named": { "text": "能把二十五班带起来，确实厉害，不过……水平这么高的老师，七班家长为什么要换走？" }
      },
      {
        "outputs": [
          { "name": "text", "links": [13], "label": "text", "type": "*", "localized_name": "text" },
          { "name": "show_help", "label": "show_help", "type": "STRING", "localized_name": "show_help" }
        ],
        "color": "#232",
        "widgets_values": ["角色音色描述：38‑45 岁中年男性，心思深沉，处事圆滑谨慎，观察力敏锐，擅长权衡各方利弊"],
        "inputs": [{ "widget": { "name": "text" }, "name": "text", "label": "text", "type": "STRING", "localized_name": "text" }],
        "flags": {},
        "type": "CR Text",
        "mode": 0,
        "size": [393.2381591796875, 263.1104431152344],
        "pos": [-14.717394828796387, 523.8682861328125],
        "id": 15,
        "properties": { "widget_ue_connectable": {}, "Node name for S&R": "CR Text" },
        "order": 4,
        "widgets_values_named": { "text": "角色音色描述：38‑45 岁中年男性，心思深沉，处事圆滑谨慎，观察力敏锐，擅长权衡各方利弊" }
      },
      {
        "mode": 0,
        "outputs": [{ "name": "OPT_CONNECTION", "label": "OPT_CONNECTION", "type": "*" }],
        "size": [247.644140625, 82],
        "color": "#232",
        "pos": [1024.7989501953125, -127.85427856445312],
        "inputs": [],
        "flags": {},
        "id": 22,
        "type": "Fast Groups Bypasser (rgthree)",
        "properties": { "customSortAlphabet": "", "matchColors": "", "widget_ue_connectable": {}, "sort": "position", "matchTitle": "", "showNav": true, "toggleRestriction": "default" },
        "order": 5
      },
      {
        "outputs": [{ "name": "模型", "links": [11], "label": "模型", "type": "QWEN3_TTS_MODEL", "localized_name": "模型" }],
        "color": "#2a363b",
        "widgets_values": ["Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign", "cuda", "fp16"],
        "inputs": [
          { "widget": { "name": "模型名称" }, "name": "模型名称", "label": "模型名称", "type": "COMBO", "localized_name": "模型名称" },
          { "widget": { "name": "运行设备" }, "name": "运行设备", "label": "运行设备", "type": "COMBO", "localized_name": "运行设备" },
          { "widget": { "name": "精度" }, "name": "精度", "label": "精度", "type": "COMBO", "localized_name": "精度" }
        ],
        "flags": {},
        "type": "Qwen3TTSModelLoader",
        "mode": 0,
        "size": [368.04998779296875, 118],
        "pos": [442.7991943359375, 99.75267791748047],
        "id": 13,
        "properties": { "widget_ue_connectable": {}, "Node name for S&R": "Qwen3TTSModelLoader" },
        "order": 6,
        "widgets_values_named": { "运行设备": "cuda", "精度": "fp16", "模型名称": "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign" }
      },
      {
        "outputs": [
          { "shape": 6, "name": "音频", "links": [2], "label": "音频", "type": "AUDIO", "localized_name": "音频" },
          { "name": "角色预设", "label": "角色预设", "type": "QWEN3_TTS_VOICE_PROMPT", "localized_name": "角色预设" }
        ],
        "color": "#2a363b",
        "widgets_values": ["", "", "自动", false, 2048, 0, "固定", 1, false, 0.8, 50, 0.8, 1.1, false],
        "inputs": [
          { "name": "模型", "link": 1, "label": "模型", "type": "QWEN3_TTS_MODEL", "localized_name": "模型" },
          { "name": "参考音频", "link": 5, "label": "参考音频", "type": "AUDIO", "localized_name": "参考音频" },
          { "widget": { "name": "文本" }, "name": "文本", "link": 10, "label": "文本", "type": "STRING", "localized_name": "文本" },
          { "widget": { "name": "参考文本" }, "name": "参考文本", "link": 9, "label": "参考文本", "type": "STRING", "localized_name": "参考文本" },
          { "widget": { "name": "语言" }, "name": "语言", "label": "语言", "type": "COMBO", "localized_name": "语言" },
          { "widget": { "name": "自动卸载模型" }, "name": "自动卸载模型", "label": "自动卸载模型", "type": "BOOLEAN", "localized_name": "自动卸载模型" },
          { "widget": { "name": "最大生成Token数" }, "name": "最大生成Token数", "label": "最大生成Token数", "type": "INT", "localized_name": "最大生成Token数" },
          { "widget": { "name": "seed" }, "name": "seed", "label": "seed", "type": "INT", "localized_name": "seed" },
          { "widget": { "name": "语速" }, "name": "语速", "label": "语速", "type": "FLOAT", "localized_name": "语速" },
          { "widget": { "name": "批量模式" }, "shape": 7, "name": "批量模式", "label": "批量模式", "type": "BOOLEAN", "localized_name": "批量模式" },
          { "widget": { "name": "top_p" }, "shape": 7, "name": "top_p", "label": "top_p", "type": "FLOAT", "localized_name": "top_p" },
          { "widget": { "name": "top_k" }, "shape": 7, "name": "top_k", "label": "top_k", "type": "INT", "localized_name": "top_k" },
          { "widget": { "name": "temperature" }, "shape": 7, "name": "temperature", "label": "temperature", "type": "FLOAT", "localized_name": "temperature" },
          { "widget": { "name": "repetition_penalty" }, "shape": 7, "name": "repetition_penalty", "label": "repetition_penalty", "type": "FLOAT", "localized_name": "repetition_penalty" },
          { "widget": { "name": "启用高级采样配置" }, "shape": 7, "name": "启用高级采样配置", "label": "启用高级采样配置", "type": "BOOLEAN", "localized_name": "启用高级采样配置" }
        ],
        "flags": {},
        "type": "Qwen3TTSVoiceClone",
        "mode": 0,
        "size": [374.5454406738281, 450],
        "pos": [1911.0260009765625, 231.48770141601562],
        "id": 1,
        "properties": { "widget_ue_connectable": {}, "Node name for S&R": "Qwen3TTSVoiceClone" },
        "order": 14,
        "widgets_values_named": { "语言": "自动", "语速": 1, "seed": 0, "参考文本": "", "文本": "", "最大生成Token数": 2048, "control_after_generate": "固定", "top_p": 0.8, "批量模式": false, "top_k": 50, "temperature": 0.8, "自动卸载模型": false, "启用高级采样配置": false, "repetition_penalty": 1.1 }
      },
      {
        "outputs": [{ "name": "AUDIO", "links": [4], "label": "AUDIO", "type": "AUDIO", "localized_name": "AUDIO" }],
        "color": "#322",
        "widgets_values": ["reference.wav", null],
        "inputs": [
          { "widget": { "name": "audio" }, "name": "audio", "label": "audio", "type": "COMBO", "localized_name": "audio" },
          { "widget": { "name": "audioUI" }, "name": "audioUI", "label": "audioUI", "type": "AUDIO_UI", "localized_name": "audioUI" },
          { "widget": { "name": "upload" }, "name": "upload", "label": "upload", "type": "AUDIOUPLOAD", "localized_name": "choose file to upload" }
        ],
        "flags": {},
        "type": "LoadAudio",
        "mode": 0,
        "size": [270, 136],
        "pos": [1188.2230224609375, 91.26830291748047],
        "id": 4,
        "properties": { "widget_ue_connectable": {}, "Node name for S&R": "LoadAudio" },
        "order": 7,
        "widgets_values_named": { "audio": "reference.wav" }
      },
      {
        "outputs": [
          { "name": "text", "links": [10], "label": "text", "type": "*", "localized_name": "text" },
          { "name": "show_help", "label": "show_help", "type": "STRING", "localized_name": "show_help" }
        ],
        "color": "#232",
        "widgets_values": ["你们的陛下，肯定也会喜欢"],
        "inputs": [{ "widget": { "name": "text" }, "name": "text", "label": "text", "type": "STRING", "localized_name": "text" }],
        "flags": {},
        "type": "CR Text",
        "mode": 0,
        "size": [393.2381591796875, 263.1104431152344],
        "pos": [1486.7236328125, 72.62744903564453],
        "id": 11,
        "properties": { "widget_ue_connectable": {}, "Node name for S&R": "CR Text" },
        "order": 8,
        "widgets_values_named": { "text": "你们的陛下，肯定也会喜欢" }
      }
    ],
    "extra": { "links_added_by_ue": [], "xzgGroups": {}, "ue_links": [], "0246.VERSION": [0, 0, 4], "pixaromaGroups": [], "ds": { "offset": [-696.9485805227944, 175.43474252432196], "scale": 0.7247295000000004 } },
    "groups": [
      { "color": "#A88", "flags": {}, "id": 1, "title": "语音克隆", "bounding": [1156.313232421875, -15.870633125305176, 1435.2232666015625, 722.3846435546875] },
      { "color": "#A88", "flags": {}, "id": 2, "title": "声音设计", "bounding": [-43.616455078125, -21.192007064819336, 1188.26904296875, 821.8668212890625] }
    ],
    "links": [
      [1, 2, 0, 1, 0, "QWEN3_TTS_MODEL"],
      [2, 1, 0, 3, 0, "AUDIO"],
      [4, 4, 0, 6, 0, "AUDIO"],
      [5, 6, 0, 1, 1, "AUDIO"],
      [7, 6, 0, 9, 0, "AUDIO"],
      [8, 6, 0, 10, 0, "AUDIO"],
      [9, 10, 0, 1, 3, "STRING"],
      [10, 11, 0, 1, 2, "STRING"],
      [11, 13, 0, 12, 0, "QWEN3_TTS_MODEL"],
      [12, 14, 0, 12, 1, "STRING"],
      [13, 15, 0, 12, 2, "STRING"],
      [14, 12, 0, 17, 0, "AUDIO"]
    ],
    "id": "70b1177c-79fa-450c-b1b6-add6e6cdb6c9",
    "config": {},
    "version": 0.4,
    "last_node_id": 23,
    "revision": 0
  };

  /* ---------- 可编辑参数 Schema ----------
   * 每个 field: { label, node, widget, idx, type, default, options?, hint?, step?, min?, max? }
   * node: 节点 id；widget: widgets_values_named 的键；idx: widgets_values 中的位置
   * type: text | textarea | number | select | checkbox
   */
  var LANG_OPTS = [
    { v: '自动', t: '自动检测' },
    { v: '中文', t: '中文' },
    { v: '英文', t: '英文' },
    { v: '日文', t: '日文' },
    { v: '韩文', t: '韩文' },
    { v: '粤语', t: '粤语' }
  ];
  var CLONE_MODEL_OPTS = [
    { v: 'Qwen/Qwen3-TTS-12Hz-1.7B-Base', t: 'Qwen3-TTS-12Hz-1.7B-Base (语音克隆)' }
  ];
  var DESIGN_MODEL_OPTS = [
    { v: 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign', t: 'Qwen3-TTS-12Hz-1.7B-VoiceDesign (声音设计)' }
  ];
  var DEVICE_OPTS = [
    { v: 'cuda', t: 'cuda (GPU)' },
    { v: 'cpu', t: 'cpu' }
  ];
  var PRECISION_OPTS = [
    { v: 'fp16', t: 'fp16' },
    { v: 'fp32', t: 'fp32' },
    { v: 'bf16', t: 'bf16' }
  ];
  var WHISPER_OPTS = [
    { v: 'large', t: 'large' },
    { v: 'medium', t: 'medium' },
    { v: 'small', t: 'small' },
    { v: 'base', t: 'base' },
    { v: 'tiny', t: 'tiny' }
  ];

  var QWEN3_FIELDS = [
    {
      sec: '语音克隆 · API 配置',
      items: [
        { key: 'fish_key', label: 'Fish Audio API Key（语音克隆用，声音设计无需）', type: 'apikey', default: '', noNode: true, hint: '在 https://fish.audio 控制台获取；不填则语音克隆不可用，声音设计仍可免费生成' },
        { key: 'clone_refaudio_file', label: '参考音频样本（3~10 秒干净人声）', type: 'file', default: '', noNode: true, stateKey: 'cloneRefName', stateKeyData: 'cloneRefAudio', hint: '用于克隆音色；声音设计无需上传' }
      ]
    },
    {
      sec: '语音克隆 · 输入文本',
      items: [
        { key: 'clone_text', label: '合成文本（CR Text → 语音克隆节点）', type: 'textarea', default: '你们的陛下，肯定也会喜欢', node: 11, widget: 'text', idx: 0, hint: '要克隆音色并合成为该文本的语音' },
        { key: 'clone_reftext', label: '参考文本（可选，填写可提升克隆准确度）', type: 'textarea', default: '', node: 1, widget: '参考文本', idx: 1, hint: '留空则由 Whisper 自动识别参考音频的文本' }
      ]
    },
    {
      sec: '语音克隆 · 参考音频（ComfyUI 参数）',
      items: [
        { key: 'clone_refaudio', label: '参考音频文件名', type: 'text', default: 'reference.wav', node: 4, widget: 'audio', idx: 0, hint: '导出 ComfyUI JSON 时使用；在线生成请用上方上传' },
        { key: 'clone_crop_start', label: '裁剪开始时间', type: 'text', default: '0:00', node: 6, widget: 'start_time', idx: 0 },
        { key: 'clone_crop_end', label: '裁剪结束时间', type: 'text', default: '0:4', node: 6, widget: 'end_time', idx: 1, hint: '格式 m:ss，建议截取 3~10 秒干净人声' }
      ]
    },
    {
      sec: '语音克隆 · 生成参数',
      items: [
        { key: 'clone_lang', label: '语言', type: 'select', default: '自动', options: LANG_OPTS, node: 1, widget: '语言', idx: 2 },
        { key: 'clone_speed', label: '语速', type: 'number', default: 1, step: 0.1, min: 0.5, max: 2, node: 1, widget: '语速', idx: 7 },
        { key: 'clone_seed', label: '随机种子 seed', type: 'number', default: 0, step: 1, min: 0, node: 1, widget: 'seed', idx: 5 },
        { key: 'clone_maxtoken', label: '最大生成 Token 数', type: 'number', default: 2048, step: 1, min: 1, node: 1, widget: '最大生成Token数', idx: 4 },
        { key: 'clone_autounload', label: '自动卸载模型', type: 'checkbox', default: false, node: 1, widget: '自动卸载模型', idx: 3 }
      ]
    },
    {
      sec: '语音克隆 · 采样参数',
      items: [
        { key: 'clone_topp', label: 'top_p', type: 'number', default: 0.8, step: 0.05, min: 0, max: 1, node: 1, widget: 'top_p', idx: 9 },
        { key: 'clone_topk', label: 'top_k', type: 'number', default: 50, step: 1, min: 0, node: 1, widget: 'top_k', idx: 10 },
        { key: 'clone_temp', label: 'temperature', type: 'number', default: 0.8, step: 0.05, min: 0, max: 2, node: 1, widget: 'temperature', idx: 11 },
        { key: 'clone_reppen', label: 'repetition_penalty', type: 'number', default: 1.1, step: 0.05, min: 0.8, max: 2, node: 1, widget: 'repetition_penalty', idx: 12 },
        { key: 'clone_adv', label: '启用高级采样配置', type: 'checkbox', default: false, node: 1, widget: '启用高级采样配置', idx: 13 }
      ]
    },
    {
      sec: '语音克隆 · 模型与 Whisper',
      items: [
        { key: 'clone_model', label: '克隆模型', type: 'select', default: 'Qwen/Qwen3-TTS-12Hz-1.7B-Base', options: CLONE_MODEL_OPTS, node: 2, widget: '模型名称', idx: 0 },
        { key: 'clone_device', label: '运行设备', type: 'select', default: 'cuda', options: DEVICE_OPTS, node: 2, widget: '运行设备', idx: 1 },
        { key: 'clone_precision', label: '精度', type: 'select', default: 'fp16', options: PRECISION_OPTS, node: 2, widget: '精度', idx: 2 },
        { key: 'whisper_size', label: 'Whisper 识别模型', type: 'select', default: 'large', options: WHISPER_OPTS, node: 10, widget: 'model_size', idx: 0, hint: '越大识别越准，越慢' }
      ]
    },
    {
      sec: '声音设计 · 输入文本与提示词',
      items: [
        { key: 'design_text', label: '合成文本（CR Text → 声音设计节点）', type: 'textarea', default: '能把二十五班带起来，确实厉害，不过……水平这么高的老师，七班家长为什么要换走？', node: 14, widget: 'text', idx: 0 },
        { key: 'design_prompt', label: '音色描述提示词（CR Text → 声音设计节点）', type: 'textarea', default: '角色音色描述：38‑45 岁中年男性，心思深沉，处事圆滑谨慎，观察力敏锐，擅长权衡各方利弊', node: 15, widget: 'text', idx: 0, hint: '用自然语言描述想要的音色、年龄、情绪等' }
      ]
    },
    {
      sec: '声音设计 · 生成参数',
      items: [
        { key: 'design_lang', label: '语言', type: 'select', default: '中文', options: LANG_OPTS, node: 12, widget: '语言', idx: 2 },
        { key: 'design_speed', label: '语速', type: 'number', default: 1, step: 0.1, min: 0.5, max: 2, node: 12, widget: '语速', idx: 7 },
        { key: 'design_seed', label: '随机种子 seed', type: 'number', default: 0, step: 1, min: 0, node: 12, widget: 'seed', idx: 5 },
        { key: 'design_maxtoken', label: '最大生成 Token 数', type: 'number', default: 2048, step: 1, min: 1, node: 12, widget: '最大生成Token数', idx: 4 },
        { key: 'design_autounload', label: '自动卸载模型', type: 'checkbox', default: false, node: 12, widget: '自动卸载模型', idx: 3 }
      ]
    },
    {
      sec: '声音设计 · 采样参数',
      items: [
        { key: 'design_topp', label: 'top_p', type: 'number', default: 0.8, step: 0.05, min: 0, max: 1, node: 12, widget: 'top_p', idx: 9 },
        { key: 'design_topk', label: 'top_k', type: 'number', default: 50, step: 1, min: 0, node: 12, widget: 'top_k', idx: 10 },
        { key: 'design_temp', label: 'temperature', type: 'number', default: 0.8, step: 0.05, min: 0, max: 2, node: 12, widget: 'temperature', idx: 11 },
        { key: 'design_reppen', label: 'repetition_penalty', type: 'number', default: 1.1, step: 0.05, min: 0.8, max: 2, node: 12, widget: 'repetition_penalty', idx: 12 },
        { key: 'design_adv', label: '启用高级采样配置', type: 'checkbox', default: false, node: 12, widget: '启用高级采样配置', idx: 13 }
      ]
    },
    {
      sec: '声音设计 · 模型',
      items: [
        { key: 'design_model', label: '声音设计模型', type: 'select', default: 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign', options: DESIGN_MODEL_OPTS, node: 13, widget: '模型名称', idx: 0 },
        { key: 'design_device', label: '运行设备', type: 'select', default: 'cuda', options: DEVICE_OPTS, node: 13, widget: '运行设备', idx: 1 },
        { key: 'design_precision', label: '精度', type: 'select', default: 'fp16', options: PRECISION_OPTS, node: 13, widget: '精度', idx: 2 }
      ]
    }
  ];

  /* ---------- 工作流列表 ---------- */
  var WORKFLOWS = [
    {
      id: 'qwen3-voice-clone',
      name: '千问3 TTS 语音克隆',
      desc: 'Qwen3-TTS 语音克隆 + 声音设计双工作流：上传参考音频克隆音色，或用自然语言描述设计新音色，导出 ComfyUI JSON。',
      groups: ['语音克隆', '声音设计'],
      json: QWEN3_VOICE_CLONE,
      sections: QWEN3_FIELDS,
      accent: 'linear-gradient(135deg,#8b5cf6,#ec4899)'
    }
  ];

  var state = {
    selected: null,
    values: {},
    fishKey: '',
    cloneRefAudio: '',
    cloneRefName: '',
    outputs: { clone: null, design: null }
  };
  var el = {};
  var inited = false;

  function $(id) { return document.getElementById(id); }
  function toast(msg, type) { if (window.HMApp && window.HMApp.toast) window.HMApp.toast(msg, type); }

  /* Fish Audio API Key 持久化（全局，不随工作流重置） */
  function loadFishKey() {
    try { return localStorage.getItem(LS_PREFIX + 'fishKey') || ''; } catch (e) { return ''; }
  }
  function saveFishKey(v) {
    try { localStorage.setItem(LS_PREFIX + 'fishKey', v || ''); } catch (e) {}
  }

  /* ---------- 默认值 / 持久化 ---------- */
  function defaults(wf) {
    var d = {};
    wf.sections.forEach(function (sec) {
      sec.items.forEach(function (f) { d[f.key] = f.default; });
    });
    return d;
  }
  function loadState(wf) {
    try {
      var raw = localStorage.getItem(LS_PREFIX + wf.id);
      if (raw) {
        var d = Object.assign(defaults(wf), JSON.parse(raw));
        d.fish_key = state.fishKey;
        return d;
      }
    } catch (e) {}
    var d = defaults(wf);
    d.fish_key = state.fishKey;
    return d;
  }
  function saveState(wf) {
    try { localStorage.setItem(LS_PREFIX + wf.id, JSON.stringify(state.values[wf.id])); } catch (e) {}
  }

  /* ---------- 工作流列表 ---------- */
  function renderList() {
    var html = '';
    WORKFLOWS.forEach(function (wf) {
      var active = state.selected && state.selected.id === wf.id;
      html += '<button class="hm-wf-card' + (active ? ' is-active' : '') + '" data-wf="' + wf.id + '" style="--wf-accent:' + wf.accent + '">';
      html += '<div class="hm-wf-card-name">' + wf.name + '</div>';
      html += '<div class="hm-wf-card-desc">' + wf.desc + '</div>';
      html += '<div class="hm-wf-card-tags">';
      wf.groups.forEach(function (g) { html += '<span class="hm-wf-tag">' + g + '</span>'; });
      html += '</div>';
      html += '</button>';
    });
    el.list.innerHTML = html;
  }

  /* ---------- 表单渲染 ---------- */
  function fieldInput(f, val) {
    if (f.type === 'apikey') {
      return '<input type="password" data-key="' + f.key + '" value="' + (val == null ? '' : String(val).replace(/"/g, '&quot;')) + '" placeholder="在 fish.audio 控制台获取">';
    }
    if (f.type === 'file') {
      var name = state[f.stateKey] || '';
      var has = !!state[f.stateKey + 'Data'];
      return '<div class="hm-wf-file">' +
        '<input type="file" data-key="' + f.key + '" accept="audio/*" hidden>' +
        '<button type="button" class="hm-pill" data-role="pick">' + (has ? '重新选择' : '上传参考音频') + '</button>' +
        '<span class="hm-wf-file-name">' + (name || '未选择文件（建议 3~10 秒干净人声）') + '</span>' +
        '</div>';
    }
    if (f.type === 'checkbox') {
      return '<label class="hm-tr-check"><input type="checkbox" data-key="' + f.key + '"' + (val ? ' checked' : '') + '><span>' + (val ? '开启' : '关闭') + '</span></label>';
    }
    if (f.type === 'select') {
      var opts = f.options.map(function (o) {
        return '<option value="' + o.v + '"' + (o.v === val ? ' selected' : '') + '>' + o.t + '</option>';
      }).join('');
      return '<select data-key="' + f.key + '">' + opts + '</select>';
    }
    if (f.type === 'textarea') {
      return '<textarea data-key="' + f.key + '" rows="3">' + (val == null ? '' : String(val)) + '</textarea>';
    }
    if (f.type === 'number') {
      var attrs = ' type="number"';
      if (f.min !== undefined) attrs += ' min="' + f.min + '"';
      if (f.max !== undefined) attrs += ' max="' + f.max + '"';
      if (f.step !== undefined) attrs += ' step="' + f.step + '"';
      return '<input' + attrs + ' data-key="' + f.key + '" value="' + val + '">';
    }
    return '<input type="text" data-key="' + f.key + '" value="' + (val == null ? '' : String(val).replace(/"/g, '&quot;')) + '">';
  }

  function renderForm() {
    var wf = state.selected;
    if (!wf) { el.form.innerHTML = ''; return; }
    var vals = state.values[wf.id];
    var html = '';
    wf.sections.forEach(function (sec) {
      html += '<div class="hm-tr-sec"><div class="hm-tr-sec-title">' + sec.sec + '</div><div class="hm-tr-grid">';
      sec.items.forEach(function (f) {
        var v = vals[f.key];
        if (v === undefined) v = f.default;
        html += '<div class="hm-tr-field">';
        html += '<label class="hm-tr-label">' + f.label + '</label>';
        html += fieldInput(f, v);
        if (f.hint) html += '<div class="hm-tr-hint">' + f.hint + '</div>';
        html += '</div>';
      });
      html += '</div></div>';
    });
    el.form.innerHTML = html;
  }

  function collectForm() {
    var wf = state.selected;
    if (!wf) return;
    var vals = state.values[wf.id];
    var nodes = el.form.querySelectorAll('[data-key]');
    nodes.forEach(function (n) {
      var k = n.getAttribute('data-key');
      if (n.type === 'checkbox') {
        vals[k] = n.checked;
        var span = n.parentElement.querySelector('span');
        if (span) span.textContent = n.checked ? '开启' : '关闭';
      } else if (n.type === 'number') {
        vals[k] = n.value === '' ? 0 : parseFloat(n.value);
      } else if (n.type === 'password') {
        vals[k] = n.value;
        if (k === 'fish_key') { state.fishKey = n.value; saveFishKey(n.value); }
      } else {
        vals[k] = n.value;
      }
    });
    saveState(wf);
  }

  /* ---------- 节点图可视化 ---------- */
  function renderDiagram() {
    var wf = state.selected;
    if (!wf) { el.diagram.innerHTML = ''; return; }
    var json = wf.json;
    var nodes = json.nodes;
    var links = json.links;

    // 计算边界
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(function (n) {
      var x = n.pos[0], y = n.pos[1], w = n.size[0], h = n.size[1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + w > maxX) maxX = x + w;
      if (y + h > maxY) maxY = y + h;
    });
    var pad = 40;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    var W = maxX - minX, H = maxY - minY;
    var scale = Math.min(1000 / W, 600 / H, 1);
    var vw = W * scale, vh = H * scale;

    function tx(x) { return (x - minX) * scale; }
    function ty(y) { return (y - minY) * scale; }

    // 建立节点索引
    var nodeMap = {};
    nodes.forEach(function (n) { nodeMap[n.id] = n; });

    var svg = '<svg class="hm-wf-svg" viewBox="0 0 ' + vw + ' ' + vh + '" preserveAspectRatio="xMidYMid meet">';
    svg += '<defs><marker id="wf-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="rgba(139,92,246,0.5)"/></marker></defs>';

    // 连线
    links.forEach(function (L) {
      var src = nodeMap[L[1]], dst = nodeMap[L[3]];
      if (!src || !dst) return;
      var sx = tx(src.pos[0] + src.size[0]);
      var sy = ty(src.pos[1] + src.size[1] / 2);
      var dx = tx(dst.pos[0]);
      var dy = ty(dst.pos[1] + dst.size[1] / 2);
      var cx = (sx + dx) / 2;
      var path = 'M' + sx + ',' + sy + ' C' + cx + ',' + sy + ' ' + cx + ',' + dy + ' ' + dx + ',' + dy;
      svg += '<path d="' + path + '" fill="none" stroke="rgba(139,92,246,0.5)" stroke-width="1.5" marker-end="url(#wf-arrow)"/>';
    });

    // 分组背景
    if (json.groups) {
      json.groups.forEach(function (g) {
        var bx = tx(g.bounding[0]), by = ty(g.bounding[1]);
        var bw = g.bounding[2] * scale, bh = g.bounding[3] * scale;
        svg += '<rect x="' + bx + '" y="' + by + '" width="' + bw + '" height="' + bh + '" rx="8" fill="rgba(139,92,246,0.06)" stroke="rgba(139,92,246,0.25)" stroke-dasharray="4 3"/>';
        svg += '<text x="' + (bx + 8) + '" y="' + (by + 16) + '" fill="rgba(236,72,153,0.9)" font-size="12" font-weight="600">' + g.title + '</text>';
      });
    }

    // 节点
    nodes.forEach(function (n) {
      var x = tx(n.pos[0]), y = ty(n.pos[1]);
      var w = n.size[0] * scale, h = n.size[1] * scale;
      var color = n.color || '#2a363b';
      svg += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="6" fill="' + color + '" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>';
      svg += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + Math.min(22, h) + '" rx="6" fill="rgba(0,0,0,0.25)"/>';
      // 节点标题
      var label = n.type + ' #' + n.id;
      svg += '<text x="' + (x + 6) + '" y="' + (y + Math.min(15, h - 4)) + '" fill="#fff" font-size="11" font-weight="600">' + label + '</text>';
    });

    svg += '</svg>';
    el.diagram.innerHTML = svg;
  }

  /* ---------- 详情区 ---------- */
  function renderDetail() {
    var wf = state.selected;
    if (!wf) {
      el.detail.innerHTML = '<div class="hm-wf-empty">← 从左侧选择一个工作流</div>';
      return;
    }
    el.detail.innerHTML =
      '<div class="hm-wf-detail-head">' +
        '<div>' +
          '<h3 class="hm-wf-detail-name">' + wf.name + '</h3>' +
          '<p class="hm-wf-detail-desc">' + wf.desc + '</p>' +
        '</div>' +
        '<div class="hm-wf-detail-actions">' +
          '<button class="hm-pill" id="wfReset">恢复默认</button>' +
          '<button class="hm-pill" id="wfPreview">预览 JSON</button>' +
          '<button class="hm-pill hm-pill-primary" id="wfExport">导出 ComfyUI JSON</button>' +
        '</div>' +
      '</div>' +
      '<div class="hm-wf-diagram" id="wfDiagram"></div>' +
      '<div class="hm-tr-form" id="wfForm"></div>' +
      '<div class="hm-wf-gen-row">' +
        '<button class="hm-pill hm-pill-primary" id="wfGenClone">🎙 生成语音克隆</button>' +
        '<button class="hm-pill hm-pill-primary" id="wfGenDesign">✨ 生成声音设计</button>' +
      '</div>' +
      '<div class="hm-wf-output" id="wfOutput"></div>' +
      '<div class="hm-wf-preview-wrap" id="wfPreviewWrap" hidden>' +
        '<div class="hm-tr-sec-title">JSON 预览</div>' +
        '<div class="hm-tr-preview-head"><button class="hm-pill" id="wfCopy">复制</button><button class="hm-pill" id="wfDownload">下载 JSON</button></div>' +
        '<pre class="hm-tr-preview" id="wfPreviewOut"></pre>' +
      '</div>';

    // 重新绑定内部元素
    el.diagram = $('wfDiagram');
    el.form = $('wfForm');
    el.output = $('wfOutput');
    el.previewWrap = $('wfPreviewWrap');
    el.previewOut = $('wfPreviewOut');
    el.btnReset = $('wfReset');
    el.btnPreview = $('wfPreview');
    el.btnExport = $('wfExport');
    el.btnGenClone = $('wfGenClone');
    el.btnGenDesign = $('wfGenDesign');
    el.btnCopy = $('wfCopy');
    el.btnDownload = $('wfDownload');

    renderForm();
    renderDiagram();
    renderOutput();
    bindDetail();
  }

  function bindDetail() {
    el.form.addEventListener('change', collectForm);
    el.form.addEventListener('input', function (e) {
      if (e.target.matches('input[type="number"]')) collectForm();
    });
    /* 文件上传处理 */
    el.form.addEventListener('click', function (e) {
      var pick = e.target.closest('[data-role="pick"]');
      if (!pick) return;
      var wrap = pick.closest('.hm-wf-file');
      if (!wrap) return;
      var input = wrap.querySelector('input[type="file"]');
      if (input) input.click();
    });
    el.form.addEventListener('change', function (e) {
      if (e.target.type !== 'file') return;
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        state.cloneRefAudio = String(reader.result);
        state.cloneRefName = file.name;
        var nameEl = e.target.parentElement.querySelector('.hm-wf-file-name');
        if (nameEl) nameEl.textContent = file.name;
        var btn = e.target.parentElement.querySelector('[data-role="pick"]');
        if (btn) btn.textContent = '重新选择';
        toast('参考音频已载入：' + file.name, 'success');
      };
      reader.readAsDataURL(file);
    });
    el.btnReset.addEventListener('click', resetDefaults);
    el.btnPreview.addEventListener('click', previewJSON);
    el.btnExport.addEventListener('click', exportJSON);
    el.btnGenClone.addEventListener('click', generateClone);
    el.btnGenDesign.addEventListener('click', generateDesign);
    el.btnCopy.addEventListener('click', copyPreview);
    el.btnDownload.addEventListener('click', downloadJSON);
  }

  /* ---------- 导出 JSON ---------- */
  function buildWorkflowJSON() {
    collectForm();
    var wf = state.selected;
    if (!wf) return null;
    var vals = state.values[wf.id];
    // 深拷贝
    var json = JSON.parse(JSON.stringify(wf.json));
    // 建立 node id → node 映射
    var nodeMap = {};
    json.nodes.forEach(function (n) { nodeMap[n.id] = n; });

    wf.sections.forEach(function (sec) {
      sec.items.forEach(function (f) {
        if (f.noNode) return; /* API Key / 文件上传等不写入工作流 JSON */
        var node = nodeMap[f.node];
        if (!node) return;
        var val = vals[f.key];
        if (val === undefined) val = f.default;
        // 更新 widgets_values_named
        if (!node.widgets_values_named) node.widgets_values_named = {};
        node.widgets_values_named[f.widget] = val;
        // 更新 widgets_values 数组对应位置
        if (Array.isArray(node.widgets_values) && f.idx < node.widgets_values.length) {
          node.widgets_values[f.idx] = val;
        }
      });
    });
    return json;
  }

  function previewJSON() {
    var json = buildWorkflowJSON();
    if (!json) return;
    el.previewOut.textContent = JSON.stringify(json, null, 2);
    el.previewWrap.hidden = false;
    el.previewWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast('已生成工作流 JSON', 'success');
  }

  function exportJSON() {
    var json = buildWorkflowJSON();
    if (!json) return;
    var blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = (state.selected.id) + '_workflow.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('ComfyUI 工作流 JSON 已下载', 'success');
  }

  function copyPreview() {
    var text = el.previewOut.textContent;
    if (!text) { toast('请先点击「预览 JSON」', 'error'); return; }
    navigator.clipboard.writeText(text).then(function () {
      toast('已复制到剪贴板', 'success');
    }).catch(function () {
      toast('复制失败，请手动选择文本', 'error');
    });
  }

  function downloadJSON() {
    var text = el.previewOut.textContent;
    if (!text) { toast('请先点击「预览 JSON」', 'error'); return; }
    var blob = new Blob([text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = (state.selected.id) + '_workflow.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('JSON 已下载', 'success');
  }

  function resetDefaults() {
    var wf = state.selected;
    if (!wf) return;
    if (!confirm('确定恢复该工作流的全部默认参数？')) return;
    state.values[wf.id] = defaults(wf);
    state.values[wf.id].fish_key = state.fishKey;
    saveState(wf);
    renderForm();
    toast('已恢复默认参数', 'info');
  }

  /* ---------- 生成音频 ---------- */
  function api() { return (window.HM && window.HM.api) || null; }

  function renderOutput() {
    if (!el.output) return;
    var out = state.outputs;
    var html = '';
    if (out.clone) {
      html += renderOutputCard('语音克隆结果', out.clone);
    }
    if (out.design) {
      html += renderOutputCard('声音设计结果', out.design);
    }
    el.output.innerHTML = html;
  }

  function renderOutputCard(title, item) {
    if (item.loading) {
      return '<div class="hm-wf-out-card"><div class="hm-wf-out-title">' + title + '</div>' +
        '<div class="hm-wf-out-loading">' + item.status || '生成中…' + '</div></div>';
    }
    if (item.error) {
      return '<div class="hm-wf-out-card is-error"><div class="hm-wf-out-title">' + title + '</div>' +
        '<div class="hm-wf-out-err">' + item.error + '</div></div>';
    }
    var url = item.url || '';
    var full = (api() && api().mediaUrl) ? api().mediaUrl(url) : url;
    return '<div class="hm-wf-out-card">' +
      '<div class="hm-wf-out-title">' + title +
        '<a class="hm-wf-out-download" href="' + full + '" download="' + (item.name || 'audio.mp3') + '">下载</a>' +
      '</div>' +
      '<audio class="hm-wf-out-player" controls src="' + full + '"></audio>' +
      (item.duration ? '<div class="hm-wf-out-meta">时长约 ' + item.duration + ' 秒 · 引擎：' + (item.engine || '') + '</div>' : '') +
    '</div>';
  }

  function generateClone() {
    collectForm();
    var wf = state.selected;
    if (!wf) return;
    var v = state.values[wf.id];

    if (!state.fishKey) {
      toast('请先填写 Fish Audio API Key', 'error');
      return;
    }
    if (!state.cloneRefAudio) {
      toast('请上传参考音频样本', 'error');
      return;
    }
    var text = String(v.clone_text || '').trim();
    if (!text) { toast('请填写合成文本', 'error'); return; }

    state.outputs.clone = { loading: true, status: '语音克隆生成中…' };
    el.btnGenClone.disabled = true;
    el.btnGenClone.textContent = '生成中…';
    renderOutput();

    var payload = {
      text: text,
      apiKey: state.fishKey,
      referenceAudio: state.cloneRefAudio,
      referenceText: String(v.clone_reftext || '').trim(),
      speed: v.clone_speed
    };

    (api() ? api().ttsClone(payload, 120000) : Promise.reject(new Error('API 未就绪')))
      .then(function (data) {
        state.outputs.clone = {
          url: data.url,
          duration: data.duration,
          engine: data.engine || 'fish-audio',
          name: 'voice-clone-' + Date.now() + '.mp3'
        };
        toast('语音克隆生成成功', 'success');
      })
      .catch(function (err) {
        var msg = (err && err.message) ? err.message : String(err);
        state.outputs.clone = { error: msg };
        toast('语音克隆失败：' + msg, 'error');
      })
      .finally(function () {
        el.btnGenClone.disabled = false;
        el.btnGenClone.textContent = '🎙 生成语音克隆';
        renderOutput();
      });
  }

  function generateDesign() {
    collectForm();
    var wf = state.selected;
    if (!wf) return;
    var v = state.values[wf.id];

    var text = String(v.design_text || '').trim();
    if (!text) { toast('请填写合成文本', 'error'); return; }
    var prompt = String(v.design_prompt || '').trim();

    state.outputs.design = { loading: true, status: '声音设计生成中（Edge-TTS 免费）…' };
    el.btnGenDesign.disabled = true;
    el.btnGenDesign.textContent = '生成中…';
    renderOutput();

    var payload = {
      text: text,
      prompt: prompt,
      speed: v.design_speed
    };

    (api() ? api().ttsDesign(payload, 60000) : Promise.reject(new Error('API 未就绪')))
      .then(function (data) {
        state.outputs.design = {
          url: data.url,
          duration: data.duration,
          engine: data.engine || 'edgetts',
          voice: data.voice,
          name: 'voice-design-' + Date.now() + '.mp3'
        };
        toast('声音设计生成成功（免费）', 'success');
      })
      .catch(function (err) {
        var msg = (err && err.message) ? err.message : String(err);
        state.outputs.design = { error: msg };
        toast('声音设计失败：' + msg, 'error');
      })
      .finally(function () {
        el.btnGenDesign.disabled = false;
        el.btnGenDesign.textContent = '✨ 生成声音设计';
        renderOutput();
      });
  }

  /* ---------- 选择工作流 ---------- */
  function selectWorkflow(id) {
    var wf = WORKFLOWS.find(function (w) { return w.id === id; });
    if (!wf) return;
    state.selected = wf;
    if (!state.values[wf.id]) state.values[wf.id] = loadState(wf);
    renderList();
    renderDetail();
  }

  /* ---------- 绑定 ---------- */
  function bind() {
    el.back.addEventListener('click', function () {
      if (window.HMApp && window.HMApp.switchView) window.HMApp.switchView('tools');
    });
    el.list.addEventListener('click', function (e) {
      var b = e.target.closest('[data-wf]');
      if (!b) return;
      selectWorkflow(b.getAttribute('data-wf'));
    });
  }

  /* ---------- 初始化 ---------- */
  function init() {
    if (inited) return;
    inited = true;
    el.back = $('wfBack');
    el.list = $('wfList');
    el.detail = $('wfDetail');
    state.fishKey = loadFishKey();
    renderList();
    bind();
    // 默认选中第一个
    if (WORKFLOWS.length) selectWorkflow(WORKFLOWS[0].id);
  }

  function enter() { init(); }
  function leave() {}

  return { enter: enter, leave: leave };
})();
