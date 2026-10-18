
// We export the worker code as a string to avoid 'Invalid URL' errors 
// caused by environment-specific relative path resolution issues.

export const PROJECTION_WORKER_CODE = `
// Box-Muller Transform for Normal Distribution
function randn_bm() {
    let u = 0, v = 0;
    while(u === 0) u = Math.random(); // Converting [0,1) to (0,1)
    while(v === 0) v = Math.random();
    return Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
}

self.onmessage = (e) => {
  const { history, lifeEvents, yearsToProject = 10 } = e.data;
  
  if (!history || history.length <= 1) {
    self.postMessage([]);
    return;
  }

  // 1. Calculate Historical Metrics (Drift & Volatility)
  const returns = [];
  for(let i = 1; i < history.length; i++) {
      const prev = history[i-1].value;
      const curr = history[i].value;
      if(prev > 0) returns.push(Math.log(curr/prev));
  }

  // Fallback defaults if not enough data
  const meanDailyReturn = returns.length > 0 
      ? returns.reduce((a,b) => a+b, 0) / returns.length 
      : 0.0003; // ~12% annual
  
  const dailyVol = returns.length > 0
      ? Math.sqrt(returns.map(x => Math.pow(x - meanDailyReturn, 2)).reduce((a,b) => a+b, 0) / returns.length)
      : 0.01; // ~16% annual vol

  const lastEntry = history[history.length - 1];
  const startValue = lastEntry.value;
  const startDate = new Date(lastEntry.date);

  // 2. Prepare Life Events Map
  // Map date string "YYYY-MM-DD" to "Days from Start"
  const eventMap = {}; // { dayIndex: totalAmount }
  if (lifeEvents && Array.isArray(lifeEvents)) {
      lifeEvents.forEach(evt => {
          const evtDate = new Date(evt.date);
          const diffTime = evtDate.getTime() - startDate.getTime();
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          if (diffDays > 0) {
              eventMap[diffDays] = (eventMap[diffDays] || 0) + (evt.type === 'EXPENSE' ? -evt.amount : evt.amount);
          }
      });
  }

  // 3. Monte Carlo Simulation
  const SIMULATIONS = 500;
  const DAYS = yearsToProject * 365;
  const paths = [];

  for(let s = 0; s < SIMULATIONS; s++) {
      const path = new Float32Array(DAYS);
      let currentVal = startValue;
      
      for(let d = 0; d < DAYS; d++) {
          // Geometric Brownian Motion: S_t = S_{t-1} * exp((mu - 0.5*sigma^2) + sigma*Z)
          // Simplified: val * (1 + drift + shock)
          const shock = randn_bm() * dailyVol;
          const drift = meanDailyReturn;
          
          currentVal = currentVal * (1 + drift + shock);
          
          // Apply Life Events
          if (eventMap[d]) {
              currentVal += eventMap[d];
          }
          
          // Prevent negative wealth in simulation (bankruptcy)
          if (currentVal < 0) currentVal = 0;
          
          path[d] = currentVal;
      }
      paths.push(path);
  }

  // 4. Aggregate Percentiles (P10, P50, P90)
  const aggregatedData = [];
  
  // Downsample for UI performance (every 30 days ~ monthly)
  const STEP = 30; 
  
  for(let d = 0; d < DAYS; d += STEP) {
      const slice = [];
      for(let s = 0; s < SIMULATIONS; s++) {
          slice.push(paths[s][d]);
      }
      slice.sort((a, b) => a - b);
      
      const futureDate = new Date(startDate);
      futureDate.setDate(startDate.getDate() + d);
      
      // Check if this specific point is near an event for UI marker
      let marker = null;
      // Look for events within this step window
      for(let k = 0; k < STEP; k++) {
          if (eventMap[d+k]) {
             marker = eventMap[d+k] < 0 ? 'EXPENSE' : 'INCOME';
             break;
          }
      }

      aggregatedData.push({
          date: futureDate.toISOString().split('T')[0],
          bear: slice[Math.floor(SIMULATIONS * 0.1)], // 10th percentile
          base: slice[Math.floor(SIMULATIONS * 0.5)], // Median
          bull: slice[Math.floor(SIMULATIONS * 0.9)], // 90th percentile
          eventMarker: marker
      });
  }

  self.postMessage(aggregatedData);
};
`;
