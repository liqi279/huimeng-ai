
/* 弹窗（预设/设置等 .modal）打开时给 body 打标记，隐藏侧栏折叠按钮。
   那个按钮 z-index 高于 .modal，会浮在弹窗左缘；大图 lightbox（9999）不受影响。 */
(function () {
  function sync() {
    document.body.classList.toggle('hm-modal-open', !!document.querySelector('.modal.is-open'));
  }
  var mo = new MutationObserver(sync);
  Array.prototype.forEach.call(document.querySelectorAll('.modal'), function (m) {
    mo.observe(m, { attributes: true, attributeFilter: ['class'] });
  });
  sync();
})();
