// Grows resident memory outside the V8 heap until killed.
const hold = [];
setInterval(() => hold.push(Buffer.alloc(16 * 1024 * 1024, 1)), 20);
