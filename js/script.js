const canvas = document.getElementById('bubble-canvas');
const ctx = canvas.getContext('2d');

let particles = [];

// Resize canvas to match screen
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// Bubble particle definition
class Bubble {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.size = Math.random() * 12 + 6; // Radius between 6px and 18px
    this.speedX = (Math.random() - 0.5) * 2; // Slight horizontal drift
    this.speedY = (Math.random() - 0.5) * 2 - 1.5; // Upward drift
    this.opacity = 1;
    this.fadeRate = Math.random() * 0.015 + 0.01;
  }

  update() {
    this.x += this.speedX;
    this.y += this.speedY;
    this.opacity -= this.fadeRate;
  }

  draw() {
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.opacity);

    // Bubble body
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(100, 180, 255, 0.35)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(140, 200, 255, 0.8)';
    ctx.stroke();

    // Bubble shine highlight
    ctx.beginPath();
    ctx.arc(
      this.x - this.size * 0.3,
      this.y - this.size * 0.3,
      this.size * 0.25,
      0,
      Math.PI * 2
    );
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fill();

    ctx.restore();
  }
}

// Spawn bubbles on mouse movement
window.addEventListener('mousemove', (e) => {
  // Spawns 2 to 3 bubbles per movement event
  for (let i = 0; i < 3; i++) {
    particles.push(new Bubble(e.clientX, e.clientY));
  }
});

// Animation loop
function animate() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let i = particles.length - 1; i >= 0; i--) {
    particles[i].update();
    particles[i].draw();

    // Remove faded bubbles
    if (particles[i].opacity <= 0) {
      particles.splice(i, 1);
    }
  }

  requestAnimationFrame(animate);
}

animate();

const logo = document.querySelector('.logo-text');
if (logo) {
  logo.innerHTML = [...logo.textContent]
    .map((c, i) => `<span class="char" style="--char-index:${i}">${c === ' ' ? '&nbsp;' : c}</span>`)
    .join('');
}