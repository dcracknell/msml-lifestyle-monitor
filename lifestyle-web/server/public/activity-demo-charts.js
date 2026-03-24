window.addEventListener('load', function () {
  if (typeof Chart === 'undefined') return;

  var paceCanvas = document.getElementById('paceHrChart');
  var loadCanvas = document.getElementById('loadTrendChart');
  if (!paceCanvas || !loadCanvas) return;

  var TEAL = '#2dd4bf';
  var AMBER = '#f59e0b';
  var GRID = '#1a2535';
  var TICK = '#64748b';
  var FONT = "'Manrope', 'Segoe UI', sans-serif";

  Chart.defaults.font.family = FONT;
  Chart.defaults.color = TICK;

  var baseScale = {
    grid: { color: GRID, drawBorder: false },
    ticks: { color: TICK, font: { size: 11 } },
  };

  new Chart(paceCanvas, {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'Session data',
          data: [
            { x: 138, y: 5.97 },
            { x: 142, y: 5.83 },
            { x: 145, y: 5.68 },
            { x: 148, y: 5.55 },
            { x: 150, y: 5.47 },
            { x: 153, y: 5.30 },
            { x: 156, y: 5.18 },
            { x: 158, y: 5.12 },
            { x: 161, y: 4.98 },
            { x: 163, y: 4.92 },
            { x: 165, y: 4.83 },
            { x: 167, y: 4.75 },
            { x: 169, y: 4.70 },
            { x: 171, y: 4.63 },
            { x: 173, y: 4.55 },
            { x: 175, y: 4.48 },
            { x: 152, y: 5.40 },
            { x: 160, y: 5.03 },
            { x: 168, y: 4.77 },
            { x: 172, y: 4.58 },
          ],
          backgroundColor: TEAL + 'bb',
          borderColor: TEAL,
          borderWidth: 0,
          pointRadius: 5,
          pointHoverRadius: 7,
          pointBorderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function (ctx) {
              var pace = ctx.parsed.y;
              var min = Math.floor(pace);
              var sec = Math.round((pace - min) * 60);
              return (
                ctx.parsed.x +
                ' bpm  ·  ' +
                min +
                ':' +
                (sec < 10 ? '0' : '') +
                sec +
                ' /km'
              );
            },
          },
        },
      },
      scales: {
        x: Object.assign({}, baseScale, {
          title: { display: true, text: 'Heart Rate (bpm)', color: TICK, font: { size: 11 } },
        }),
        y: Object.assign({}, baseScale, {
          reverse: true,
          title: { display: true, text: 'Pace (min/km)', color: TICK, font: { size: 11 } },
          ticks: {
            color: TICK,
            font: { size: 11 },
            callback: function (value) {
              var min = Math.floor(value);
              var sec = Math.round((value - min) * 60);
              return min + ':' + (sec < 10 ? '0' : '') + sec;
            },
          },
        }),
      },
    },
  });

  var sessions = ['1 Mar', '3 Mar', '5 Mar', '7 Mar', '9 Mar', '11 Mar', '13 Mar'];
  var loads = [92, 35, 78, 118, 28, 95, 88];
  var colours = loads.map(function (value) {
    if (value >= 100) return TEAL + 'dd';
    if (value >= 60) return AMBER + 'cc';
    return '#64748b55';
  });

  new Chart(loadCanvas, {
    type: 'bar',
    data: {
      labels: sessions,
      datasets: [
        {
          label: 'Training Load',
          data: loads,
          backgroundColor: colours,
          borderColor: colours.map(function (color) {
            return color.slice(0, 7);
          }),
          borderWidth: 1,
          borderRadius: 2,
          borderSkipped: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function (ctx) {
              var value = ctx.parsed.y;
              var tier = value >= 100 ? 'High' : value >= 60 ? 'Med' : 'Low';
              return value + ' pts  ·  ' + tier;
            },
          },
        },
      },
      scales: {
        x: baseScale,
        y: Object.assign({}, baseScale, {
          beginAtZero: true,
          title: { display: true, text: 'Suffer score', color: TICK, font: { size: 11 } },
        }),
      },
    },
  });
});
