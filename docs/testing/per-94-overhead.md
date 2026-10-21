# PER-94 instrumentation control

Same build `2016fc40445d7d68a677d813b43e6772d3b357d7`, fingerprint `6437b9576304162c488a1aa5b9d270635b1b41b6412c21dd4209778fe7a78bbe`.
Primary began 2026-10-21T13:51:13.791Z; separate instrumentation-off control began 2026-10-21T14:07:27.923Z.

The primary contains 166 unclassified CDP failures/cancellations; the instrumentation-off control contains 56. Both have zero observed HTTP/runtime errors. Cause codes were not retained, so the counts do not establish an application-network error rate.

This is a sequential A/B noise/overhead check, not proof of a causal speed difference. The control disables pool/query wrappers, wait sampling, EXPLAIN capture and browser PerformanceObservers. CDP network accounting/throttling, the dead outbound proxy, application logging, fixture shape and Playwright actionability remain common to both runs. Their absolute overhead is unquantified. Host/JIT/thermal drift and sample-order effects remain possible; negative deltas are not optimisations.

| Endpoint | Concurrency | n each | Instrumented p50 / p95 ms | Control p50 / p95 ms | p50 relative delta |
| --- | --- | --- | --- | --- | --- |
| home | 1 | 1000 | 5.252 / 5.839 | 5.212 / 5.771 | 0.8% |
| home | 4 | 1000 | 13.354 / 14.591 | 13.67 / 14.64 | -2.3% |
| items | 1 | 1000 | 3.001 / 3.37 | 2.841 / 3.209 | 5.6% |
| items | 4 | 1000 | 2.407 / 3.366 | 2.442 / 6.038 | -1.4% |
| filtered | 1 | 1000 | 4.812 / 5.081 | 4.813 / 5.108 | -0.0% |
| filtered | 4 | 1000 | 13.145 / 14.796 | 13.248 / 15.144 | -0.8% |
| facets | 1 | 1000 | 3.761 / 3.922 | 3.554 / 3.746 | 5.8% |
| facets | 4 | 1000 | 7.213 / 8.712 | 7.242 / 7.888 | -0.4% |
| item | 1 | 1000 | 2.744 / 3.375 | 2.547 / 3.959 | 7.7% |
| item | 4 | 1000 | 1.584 / 2.909 | 2.244 / 2.788 | -29.4% |
| spending | 1 | 1000 | 3.384 / 3.602 | 3.163 / 3.416 | 7.0% |
| spending | 4 | 1000 | 4.802 / 5.229 | 4.859 / 5.418 | -1.2% |
| merchants | 1 | 1000 | 3.398 / 3.71 | 3.194 / 3.505 | 6.4% |
| merchants | 4 | 1000 | 4.538 / 4.945 | 4.602 / 5.084 | -1.4% |

| Home profile/cache | n each | Instrumented median ready ms | Control median ready ms | Relative delta |
| --- | --- | --- | --- | --- |
| desktop/cold | 5 | 173.2 | 145.4 | 19.2% |
| desktop/warm | 5 | 103.7 | 97.6 | 6.2% |
| mobile/cold | 5 | 3338.2 | 3336.5 | 0.1% |
| mobile/warm | 5 | 583.6 | 559.9 | 4.2% |
