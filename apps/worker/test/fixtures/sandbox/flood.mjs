// Writes far more than the permitted output.
const chunk = Buffer.alloc(64 * 1024, 120);
const write = () => {
  while (process.stdout.write(chunk));
  process.stdout.once('drain', write);
};
write();
