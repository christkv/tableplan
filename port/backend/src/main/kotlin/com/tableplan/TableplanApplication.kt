package com.tableplan

import com.tableplan.config.TableplanProperties
import com.tableplan.config.DotenvLoader
import com.tableplan.operator.OperatorCommandRunner
import org.springframework.boot.WebApplicationType
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.builder.SpringApplicationBuilder
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.boot.runApplication
import org.springframework.scheduling.annotation.EnableScheduling
import java.nio.file.Path
import kotlin.system.exitProcess

@SpringBootApplication
@EnableConfigurationProperties(TableplanProperties::class)
@EnableScheduling
class TableplanApplication

fun main(args: Array<String>) {
    println("Tableplan working directory: ${Path.of("").toAbsolutePath().normalize()}")
    DotenvLoader.load()
    val command = args.firstOrNull()
    if (command == null || command == "serve" || command.startsWith("--")) {
        val serverArgs = if (command == "serve") args.drop(1).toTypedArray() else args
        runApplication<TableplanApplication>(*serverArgs)
        return
    }
    val context =
        SpringApplicationBuilder(TableplanApplication::class.java)
            .web(WebApplicationType.NONE)
            .properties(
                "spring.main.banner-mode=off",
                "tableplan.jobs.enabled=false",
            )
            .run(*args.drop(1).toTypedArray())
    val exitCode =
        try {
            context.getBean(OperatorCommandRunner::class.java).run(command, args.drop(1))
        } catch (error: Exception) {
            System.err.println(error.message ?: error.javaClass.simpleName)
            1
        } finally {
            context.close()
        }
    if (exitCode != 0) exitProcess(exitCode)
}
