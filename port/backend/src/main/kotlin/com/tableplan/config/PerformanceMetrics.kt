package com.tableplan.config

import io.micrometer.core.instrument.MeterRegistry
import io.micrometer.core.instrument.Timer
import org.springframework.stereotype.Component
import java.util.concurrent.ConcurrentHashMap

@Component
class PerformanceMetrics(
    private val registry: MeterRegistry,
) {
    private val timers = ConcurrentHashMap<String, Timer>()

    fun <T> record(operation: String, block: () -> T): T {
        val sample = Timer.start(registry)
        try {
            return block()
        } finally {
            sample.stop(
                timers.computeIfAbsent(operation) {
                    Timer.builder("tableplan.operation.duration")
                        .description("Duration of performance-sensitive Table Rhythm operations")
                        .tag("operation", operation)
                        .publishPercentileHistogram()
                        .register(registry)
                },
            )
        }
    }
}
