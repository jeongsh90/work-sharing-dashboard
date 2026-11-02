// 1) 낱말 감싸기: 띄어쓰기에서만 줄이 바뀌게(괄호·하이픈 앞뒤에서 끊기지 않게) 텍스트를 낱말 단위 nowrap 으로 감싼다 — Figma keep-all(U+2028) 결과와 같게.
//    띄어쓰기 없이 긴 낱말(원료명 '…(밀(호주,미국산))),무(국산)' 등)은 쉼표 뒤에서도 줄을 바꿀 수 있게 <wbr> 를 넣는다.
//    그래도 칸보다 긴 낱말은 감싸기를 풀어 칸 안에서 끊는다(글자가 영역 밖으로 나가지 않게).
// 2) render.ps1 이 ?only=파일명 으로 열면 그 섹션만 남긴다. 그냥 열면 전체 미리보기.
(function () {
  function wrapWords(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), nodes = [], n;
    while ((n = walker.nextNode())) if (n.nodeValue.trim() && !n.parentNode.closest('.w, script, style')) nodes.push(n);
    nodes.forEach(function (t) {
      var parts = t.nodeValue.split(/([ \n\u00a0]+)/), frag = document.createDocumentFragment();
      parts.forEach(function (p) {
        if (!p) return;
        if (/^[ \n\u00a0]+$/.test(p)) { frag.appendChild(document.createTextNode(p)); return; }
        var pieces = p.length > 12 ? p.split(/(?<=,)/) : [p];
        pieces.forEach(function (q, i) {
          if (i > 0) frag.appendChild(document.createElement('wbr'));
          var s = document.createElement('span'); s.className = 'w'; s.textContent = q; frag.appendChild(s);
        });
      });
      t.parentNode.replaceChild(frag, t);
    });
  }
  document.querySelectorAll('section[data-out]').forEach(wrapWords);
  document.querySelectorAll('section[data-out] .w').forEach(function (s) {
    var box = s.parentElement; while (box && getComputedStyle(box).display === 'inline') box = box.parentElement;
    if (box && s.getBoundingClientRect().width > box.clientWidth + 1) { s.style.whiteSpace = 'normal'; s.style.wordBreak = 'break-all'; }
  });
  var only = new URLSearchParams(location.search).get('only');
  var secs = document.querySelectorAll('section[data-out]');
  if (only) { secs.forEach(function (s) { if (s.getAttribute('data-out') !== only) s.remove(); }); return; }
  document.documentElement.style.background = document.body.style.background = '#444';
  secs.forEach(function (s) { s.style.marginBottom = '10px'; s.title = s.getAttribute('data-out'); });
})();