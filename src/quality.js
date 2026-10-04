// ispeed's own connection rating: three 1-5 scores, averaged. Thresholds are deliberately plain
// and documented in the help overlay.
//   speed      how much the line moves (download weighs more than upload)
//   response   how quickly it answers (ping)
//   stability  how steadily it answers (jitter)
const score = (value, limits) => {
  const index = limits.findIndex((limit) => value >= limit);
  return index === -1 ? 1 : 5 - index;
};
const lowScore = (value, limits) => {
  const index = limits.findIndex((limit) => value <= limit);
  return index === -1 ? 1 : 5 - index;
};

export const pingScore = (value) => lowScore(value, [20, 40, 70, 120]);
export const jitterScore = (value) => lowScore(value, [3, 8, 15, 30]);

const labels = { 5: "Excellent", 4: "Good", 3: "Fair", 2: "Poor", 1: "Bad" };

export function rate({ download, upload, ping, jitter }) {
  const speed = Math.round(0.65 * score(download, [100, 50, 25, 10]) + 0.35 * score(upload, [50, 25, 12, 5]));
  const response = pingScore(ping);
  const stability = jitterScore(jitter);
  const parts = { speed, response, stability };
  const weakest = Math.min(speed, response, stability);
  const overall = Math.min(Math.round((speed + response + stability) / 3), weakest + 2);
  let verdict = "Smooth for streaming, calls and gaming";
  if (overall < 4) {
    const limit = Object.keys(parts).find((key) => parts[key] === weakest);
    verdict = {
      speed: "Speed is the limit: large downloads and 4K will feel slow",
      response: "High latency: calls and games may lag",
      stability: "Uneven latency: calls may stutter"
    }[limit];
  }
  return { overall, label: labels[overall], verdict, ...parts };
}
