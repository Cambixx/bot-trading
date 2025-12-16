/**
 * Machine Learning Moving Average Service
 * Implements LuxAlgo's ML Moving Average logic using Gaussian Process Regression
 * with a Radial Basis Function (RBF) kernel.
 */

class Matrix {
    constructor(rows, cols, fill = 0) {
        this.rows = rows;
        this.cols = cols;
        this.data = Array(rows).fill().map(() => Array(cols).fill(fill));
    }

    set(row, col, value) {
        if (row >= 0 && row < this.rows && col >= 0 && col < this.cols) {
            this.data[row][col] = value;
        }
    }

    get(row, col) {
        if (row >= 0 && row < this.rows && col >= 0 && col < this.cols) {
            return this.data[row][col];
        }
        return 0;
    }

    static fromArray(arr) {
        const m = new Matrix(arr.length, arr[0].length);
        for (let i = 0; i < arr.length; i++) {
            for (let j = 0; j < arr[0].length; j++) {
                m.set(i, j, arr[i][j]);
            }
        }
        return m;
    }

    multiply(other) {
        if (typeof other === 'number') {
            const res = new Matrix(this.rows, this.cols);
            for (let i = 0; i < this.rows; i++) {
                for (let j = 0; j < this.cols; j++) {
                    res.set(i, j, this.data[i][j] * other);
                }
            }
            return res;
        } else {
            // Matrix multiplication
            if (this.cols !== other.rows) throw new Error(`Matrix dimension mismatch: ${this.cols} != ${other.rows}`);
            const res = new Matrix(this.rows, other.cols);
            for (let i = 0; i < this.rows; i++) {
                for (let j = 0; j < other.cols; j++) {
                    let sum = 0;
                    for (let k = 0; k < this.cols; k++) {
                        sum += this.data[i][k] * other.get(k, j);
                    }
                    res.set(i, j, sum);
                }
            }
            return res;
        }
    }

    add(other) {
        if (typeof other === 'number') { // Scalar add
            const res = new Matrix(this.rows, this.cols);
            for (let i = 0; i < this.rows; i++) {
                for (let j = 0; j < this.cols; j++) {
                    res.set(i, j, this.data[i][j] + other);
                }
            }
            return res;
        }

        if (this.rows !== other.rows || this.cols !== other.cols) throw new Error("Matrix dimension mismatch for add");
        const res = new Matrix(this.rows, this.cols);
        for (let i = 0; i < this.rows; i++) {
            for (let j = 0; j < this.cols; j++) {
                res.set(i, j, this.data[i][j] + other.get(i, j));
            }
        }
        return res;
    }

    transpose() {
        const res = new Matrix(this.cols, this.rows);
        for (let i = 0; i < this.rows; i++) {
            for (let j = 0; j < this.cols; j++) {
                res.set(j, i, this.data[i][j]);
            }
        }
        return res;
    }

    // Gaussian elimination for inverse (Assumes non-singular square matrix)
    inverse() {
        if (this.rows !== this.cols) throw new Error("Matrix must be square");
        const n = this.rows;
        const identity = new Matrix(n, n);
        for (let i = 0; i < n; i++) identity.set(i, i, 1);

        const mat = this.data.map(row => [...row]);
        const inv = identity.data.map(row => [...row]);

        for (let i = 0; i < n; i++) {
            let diag = mat[i][i];
            // Simple pivot check (not full pivot for brevity, but should suffice for well-conditioned kernels)
            if (Math.abs(diag) < 1e-10) {
                // Try to swap with lower row
                let swapped = false;
                for (let k = i + 1; k < n; k++) {
                    if (Math.abs(mat[k][i]) > 1e-10) {
                        [mat[i], mat[k]] = [mat[k], mat[i]];
                        [inv[i], inv[k]] = [inv[k], inv[i]];
                        diag = mat[i][i];
                        swapped = true;
                        break;
                    }
                }
                if (!swapped) throw new Error("Matrix is singular");
            }

            for (let j = 0; j < n; j++) {
                mat[i][j] /= diag;
                inv[i][j] /= diag;
            }

            for (let k = 0; k < n; k++) {
                if (k !== i) {
                    const factor = mat[k][i];
                    for (let j = 0; j < n; j++) {
                        mat[k][j] -= factor * mat[i][j];
                        inv[k][j] -= factor * inv[i][j];
                    }
                }
            }
        }
        return Matrix.fromArray(inv);
    }

    // Get a row as a simple array
    getRow(rowIdx) {
        return this.data[rowIdx];
    }
}

// RBF Kernel Function
function rbf(x1, x2, l) {
    return Math.exp(-Math.pow(x1 - x2, 2) / (2.0 * Math.pow(l, 2)));
}

// Compute Kernel Matrix
function kernel_matrix(X1, X2, l) {
    const km = new Matrix(X1.length, X2.length);
    for (let i = 0; i < X1.length; i++) {
        for (let j = 0; j < X2.length; j++) {
            km.set(i, j, rbf(X1[i], X2[j], l));
        }
    }
    return km;
}

/**
 * Calculates Machine Learning Moving Average
 * @param {Array<number>} prices - Array of close prices (must be length >= window)
 * @param {Object} config - { window, forecast, sigma, mult }
 * @returns {Object} { upper, lower, out, signal }
 *   signal: 1 (Bullish Extremity/Overbought?), -1 (Bearish Extremity/Oversold?), 0 (Neutral)
 */
export function calculateMLMovingAverage(prices, config = {}) {
    const {
        window = 30, // Previously 100 in Pine default, but user image shows 30
        forecast = 2,
        sigma = 0.125,
        mult = 1.75
    } = config;

    if (prices.length < window) return null;

    // Use only the analysis window + necessary history
    // We need to compute for the LAST bar only for real-time signals, 
    // but typically we want the whole series?
    // The Pine script calculates it historically on every bar.
    // To safe perf in JS, let's calculate for the *most recent* point.
    // However, signal logic `os` depends on previous bar's `out`.
    // So we need at least 2 points of history (current and previous).

    // Let's implement a 'light' version that computes the last N points.
    // For now, let's just compute the LAST point to generate the current signal/value.

    // Need `os` state (persistent). 
    // If we only run this once, we can't track `os` change from prev.
    // We should compute the last 2 steps.

    // Build static matrices that don't depend on prices (X1, X2 are just indices)
    // xtrain: [0, 1, ..., window-1]
    // xtest: [0, 1, ..., window+forecast-1]
    const xtrain = Array.from({ length: window }, (_, i) => i);
    const xtest = Array.from({ length: window + forecast }, (_, i) => i);

    // Compute Ktrain + sigma penalty once
    // Ktrain = kernel_matrix(xtrain, xtrain, window) + (Identity * sigma^2)
    const KtrainRaw = kernel_matrix(xtrain, xtrain, window);
    const Identity = new Matrix(window, window);
    for (let i = 0; i < window; i++) Identity.set(i, i, 1);

    const Ktrain = KtrainRaw.add(Identity.multiply(sigma * sigma));
    const K_inv = Ktrain.inverse(); // Invert once

    // K_star = kernel_matrix(xtrain, xtest, window)
    const K_star = kernel_matrix(xtrain, xtest, window);

    // K_row = K_star^T * K_inv -> take last row for forecast point
    // This represents the weights for the dot product
    const K_weights_mat = K_star.transpose().multiply(K_inv);

    // We need the row corresponding to the "forecast" point in the future (last index of xtest)
    const K_row_weights = K_weights_mat.getRow(window + forecast - 1); // Array of weights

    // We need to calculate for the last 2 indices to check signal state change
    const calculationIndices = [prices.length - 2, prices.length - 1];

    // Helper calculate single point
    const computePoint = (idx) => {
        // Data slice for this window: ends at idx (inclusive), length 'window'
        // src[window - 1 - i] logic in Pine means we look back.
        // In Pine: `mean = ta.sma(src, window)`
        // `dotprod += K_row.get(i) * (src[window-1 - i] - mean)`
        // `out := dotprod + mean`

        // This effectively centers the data around the mean, applies weights, adds mean back.

        const start = idx - window + 1;
        if (start < 0) return null;
        const slice = prices.slice(start, idx + 1); // Length: window

        // Calculate Mean (SMA)
        const mean = slice.reduce((a, b) => a + b, 0) / window;

        let dotprod = 0;
        // Pine loop: i = 0 to window-1
        // src[window-1-i] accessing the slice backwards?
        // Pine: src is current bar. src[0] is current. src[1] is prev.
        // If we have slice [p_0, p_1, ..., p_last]
        // p_last corresponds to src[0] (bar_index)
        // src[window-1-i]: when i=0 -> src[window-1] (oldest in window?)

        // Let's re-read Pine carefully:
        // `xtrain` pushed i from 0 to window-1.
        // `K_row` computed based on distance between training points (0..w-1) and test point (w+forecast-1).
        // The weights correspond to the x-positions.
        // Code: `K_row.get(i) * (src[window-1 - i] - mean)`
        // `src[window-1 - i]` -> if i=0, src[window-1]. If i=window-1, src[0].
        // So weight[0] (oldest x=0) multiplies src[window-1] (which is... relative to current bar?)
        // In Pine `src` is the series. `src[k]` is value k bars ago.
        // If we are at bar T. Window=100.
        // We use data T, T-1, ..., T-99.
        // i=0: x=0. src[99] -> Value at T-99.
        // i=99: x=99. src[0] -> Value at T.
        // So yes, x corresponds to time index in the window. 
        // x=0 is oldest, x=window-1 is current bar.

        // In our `slice`, index 0 is oldest, index window-1 is newest.
        // So slice[i] corresponds to x=i.

        for (let i = 0; i < window; i++) {
            dotprod += K_row_weights[i] * (slice[i] - mean);
        }

        const out = dotprod + mean;

        const mae = slice.reduce((sum, val) => sum + Math.abs(val - out), 0) / window * mult;
        const upper = out + mae;
        const lower = out - mae;

        return { out, upper, lower, close: slice[window - 1] };
    };

    const prevResult = computePoint(calculationIndices[0]);
    const currResult = computePoint(calculationIndices[1]);

    if (!prevResult || !currResult) return null;

    // Determine OS state
    // Pine: `os := close > upper and out > out[1] ? 1 : close < lower and out < out[1] ? 0 : os`
    // Note: `out[1]` means previous `out`.
    const prevOut = prevResult.out;
    const currOut = currResult.out;
    const currClose = currResult.close;
    const currUpper = currResult.upper;
    const currLower = currResult.lower;

    // We assume 'os' starts at 0 (or some default). We can't know the TRUE historical OS w/o running full history.
    // However, the signal triggers on CHANGE of OS.
    // Let's return the conditions directly.

    // Pine Logic interpretation:
    // os switches to 1 (Bull/High) if Price > Upper AND AlgoCurve Rising.
    // os switches to 0 (Bear/Low)  if Price < Lower AND AlgoCurve Falling.
    // Otherwise holds previous state.

    // Return discrete signal:
    // 'UPPER_EXTREMITY' if close > upper && currOut > prevOut
    // 'LOWER_EXTREMITY' if close < lower && currOut < prevOut

    let signal = null;
    if (currClose > currUpper && currOut > prevOut) {
        signal = 'UPPER_EXTREMITY'; // Potential Overbought / Sell? or Breakout?
        // In LuxAlgo image: "Upper Extremity" (Blue) and "Lower Extremity" (Red).
        // Usually Upper=Sell Risk, Lower=Buy Opp.
    } else if (currClose < currLower && currOut < prevOut) {
        signal = 'LOWER_EXTREMITY';
    }

    return {
        value: currOut,
        upper: currUpper,
        lower: currLower,
        signal,
        prevValue: prevOut,
        price: currClose
    };
}
