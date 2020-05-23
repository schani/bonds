function assert(x) {
  if (!x) {
    throw new Error("Assertion failed");
  }
}

const colorArray = [
  "#A3A84F",
  "#FF718D",
  "#29CDFF",
  "#42E5E0",
  "#7A79FF",
  // "#4467F8",
  // "#E16AE3",
  // "#18A0AE",
  // "#E19A7A",
  // "#A659E3"
];

const includePredators = true;

const predatorColor = "#FF4444";
const predatorSpeedBonus = 1.9;

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d", { alpha: false });

const canvasWidth = canvas.scrollWidth;
const canvasHeight = canvas.scrollHeight;

const MAX_VELOCITY = 5;
const radius = 200;
const scale = 5;

const width = canvasWidth * scale;
const height = canvasHeight * scale;

let boids = [];

const drawCenterOfGravity = false;

const turbo = 1;

for (let i = 0; i < 30000; i++) {
  const mod = i % colorArray.length;
  const predator = i % 200 === 0 && includePredators;
  const color = predator ? predatorColor : colorArray[mod];
  const targetVelocity = predator
    ? MAX_VELOCITY * predatorSpeedBonus
    : MAX_VELOCITY; //* (mod + 1) /  colorArray.length;

  boids.push(new Boid(width, height, color, targetVelocity, predator));
}

class DefaultArray2D {
  constructor(makeDefault) {
    this.makeDefault = makeDefault;
    this.arr = [];
  }

  get(x, y) {
    let row = this.arr[x];
    if (row === undefined) {
      row = this.arr[x] = [];
    }
    let cell = row[y];
    if (cell === undefined) {
      cell = row[y] = this.makeDefault();
    }
    return cell;
  }
}

function boidSlice(b) {
  let x = b.position.x;
  let y = b.position.y;
  let sliceX = Math.max(0, Math.floor(x / radius));
  let sliceY = Math.max(0, Math.floor(y / radius));

  return { x: sliceX, y: sliceY };
}

function slice(boids) {
  let sliceArray = new DefaultArray2D(() => []);
  for (const b of boids) {
    let { x, y } = boidSlice(b);
    sliceArray.get(x, y).push(b);
  }

  return sliceArray;
}

function calculateSingleBoid(boid, sliceArray) {
  // get the list of all the nearby boids and store in nearBoids
  const nearBoids = [];

  let { x, y } = boidSlice(boid);

  for (const dx of [-1, 0, 1]) {
    for (const dy of [-1, 0, 1]) {
      const sx = x + dx;
      const sy = y + dy;

      for (const b of sliceArray.get(sx, sy)) {
        if (b !== boid) {
          let dist = Vector2.dist(b.position, boid.position);
          if (dist < radius) {
            nearBoids.push(b);
          }
        }
      }
    }
  }

  return boid.calculate(nearBoids);
}

function drawBoids(frameDuration, numPredators, withBoids) {
  ctx.save();

  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  ctx.fillStyle = "black";
  ctx.font = "16px serif";
  ctx.fillText(boids.length.toString(), canvasWidth - 50, canvasHeight - 5);
  ctx.fillText(
    Math.floor(1000 / frameDuration).toString(),
    5,
    canvasHeight - 5
  );
  ctx.fillText(numPredators, canvasWidth / 2, canvasHeight - 5);

  if (withBoids) {
    ctx.scale(1 / scale, 1 / scale);

    let sum = new Vector2(0, 0);
    // for (const color of [...colorArray, predatorColor]) {
    // ctx.beginPath();
    ctx.fillStyle = colorArray[0];
    for (const boid of boids) {
      // if (boid.color !== color) continue;
      boid.draw(ctx);
      sum.add(boid.position);
    }
    // ctx.fill();
    // }

    if (drawCenterOfGravity) {
      sum.div(boids.length);
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(sum.x - 30, sum.y - 30, 60, 60);
    }
  }

  ctx.restore();
}

function boidsMain() {
  let lastFrameTime = Date.now();

  function animate() {
    requestAnimationFrame(animate);

    const now = Date.now();
    const frameDuration = now - lastFrameTime;
    lastFrameTime = now;

    let numFrames = turbo;
    if (frameDuration > 20) {
      numFrames *= 2;
    }

    let numPredators;
    for (let i = 0; i < numFrames; i++) {
      const newBoids = [];
      const sliceArray = slice(boids);
      for (const boid of boids) {
        newBoids.push(...calculateSingleBoid(boid, sliceArray));
      }
      boids = newBoids;
      for (const boid of boids) {
        boid.update();
      }

      numPredators = boids.filter((b) => b.predator).length;
      updateGraph(boids.length - numPredators, numPredators);
    }

    drawBoids(frameDuration, numPredators, true);
  }

  animate();
}

function simulateKernel(f, options) {
  return function (...args) {
    const results = [];
    for (let x = 0; x < options.output[0]; x++) {
      const k = { thread: { x }, constants: options.constants };
      results.push(f.apply(k, args));
    }
    return results;
  };
}

// function makeKernel(f, options) {
//   return simulateKernel(f, options);
// }

// function makeKernel(f, options) {
//   return gpu.createKernel(f, options);
// }

function gpuMain() {
  const gpu = new GPU({ mode: "gpu" });

  const kernel = gpu.createKernel(
    function (boidXYs, boidSlices, neighborStarts, neighborEnds, sqrRadius) {
      const separationCoefficient = 3;

      let [x, y] = boidXYs[this.thread.x];
      let sliceIndex = boidSlices[this.thread.x];

      let separationSteerX = 0.0;
      let separationSteerY = 0.0;

      let startsEndsIndex = sliceIndex * 9;
      for (let ni = 0; ni < 9; ni++) {
        const start = neighborStarts[startsEndsIndex + ni];
        const end = neighborEnds[startsEndsIndex + ni];
        for (let i = start; i < end; i++) {
          if (i !== this.thread.x) {
            const [x1, y1] = boidXYs[i];

            const dx = x - x1;
            const dy = y - y1;
            const sqrDist = dx * dx + dy * dy;
            if (sqrDist <= sqrRadius) {
              const ndx = dx / sqrDist;
              const ndy = dy / sqrDist;
              separationSteerX += ndx * separationCoefficient;
              separationSteerY += ndy * separationCoefficient;
            }
          }
        }
      }

      return [x + separationSteerX, y + separationSteerY];
    },
    {
      constants: { numBoids: boids.length },
      output: [boids.length],
    }
  );

  const widthInSlices = Math.ceil(width / radius);
  const heightInSlices = Math.ceil(height / radius);

  function indexOfSlice(x, y) {
    return y * widthInSlices + x;
  }

  let lastFrameTime = Date.now();

  function animate() {
    requestAnimationFrame(animate);

    const now = Date.now();
    const frameDuration = now - lastFrameTime;
    lastFrameTime = now;

    const sliced = slice(boids);

    const boidXYs = [];
    const boidSlices = [];
    const sliceStarts = [];
    const sliceEnds = [];

    let maxSliceLength = 0;

    for (let sliceY = 0; sliceY < heightInSlices; sliceY++) {
      for (let sliceX = 0; sliceX < widthInSlices; sliceX++) {
        const sliceIndex = sliceStarts.length;
        assert(sliceIndex === indexOfSlice(sliceX, sliceY));

        const sliceStart = boidXYs.length;
        const sliceBoids = sliced.get(sliceX, sliceY);
        for (const b of sliceBoids) {
          boidXYs.push([b.position.x, b.position.y]);
          boidSlices.push(sliceIndex);
        }
        const sliceEnd = boidXYs.length;
        sliceStarts.push(sliceStart);
        sliceEnds.push(sliceEnd);
        maxSliceLength = Math.max(maxSliceLength, sliceEnd - sliceStart);
      }
    }

    const neighborStarts = [];
    const neighborEnds = [];

    for (let sliceY = 0; sliceY < heightInSlices; sliceY++) {
      for (let sliceX = 0; sliceX < widthInSlices; sliceX++) {
        for (const dy of [-1, 0, 1]) {
          for (const dx of [-1, 0, 1]) {
            const nx = sliceX + dx;
            const ny = sliceY + dy;

            if (
              nx < 0 ||
              ny < 0 ||
              nx >= widthInSlices ||
              ny >= heightInSlices
            ) {
              neighborStarts.push(0);
              neighborEnds.push(0);
            } else {
              const sliceIndex = indexOfSlice(nx, ny);
              neighborStarts.push(sliceStarts[sliceIndex]);
              neighborEnds.push(sliceEnds[sliceIndex]);
            }
          }
        }
      }
    }

    console.log("max slice length", maxSliceLength);

    const resultXYs = kernel(
      boidXYs,
      boidSlices,
      neighborStarts,
      neighborEnds,
      radius * radius
    );

    let boidIndex = 0;
    for (let sliceY = 0; sliceY < heightInSlices; sliceY++) {
      for (let sliceX = 0; sliceX < widthInSlices; sliceX++) {
        const sliceBoids = sliced.get(sliceX, sliceY);
        for (const b of sliceBoids) {
          const xy = resultXYs[boidIndex];
          b.position.x = xy[0];
          b.position.y = xy[1];
          boidIndex++;
        }
      }
    }

    drawBoids(frameDuration, 0, true);

    // let result;
    // const start = Date.now();
    // for (let i = 0; i < 1; i++) {
    //   result = kernel(
    //     boidXYs,
    //     boidSlices,
    //     neighborStarts,
    //     neighborEnds,
    //     radius * radius
    //   );
    // }
    // console.log(Date.now() - start, result);
  }

  animate();
}

// boidsMain();
gpuMain();
