package com.tableplan.config

import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.util.Properties

object DotenvLoader {
    private val keyPattern = Regex("[A-Za-z_][A-Za-z0-9_]*")
    private val systemPropertyAliases =
        mapOf(
            "AWS_ACCESS_KEY_ID" to "aws.accessKeyId",
            "AWS_SECRET_ACCESS_KEY" to "aws.secretAccessKey",
            "AWS_SESSION_TOKEN" to "aws.sessionToken",
            "SPRING_SECURITY_OAUTH2_CLIENT_REGISTRATION_GOOGLE_CLIENT_ID" to
                "spring.security.oauth2.client.registration.google.client-id",
            "SPRING_SECURITY_OAUTH2_CLIENT_REGISTRATION_GOOGLE_CLIENT_SECRET" to
                "spring.security.oauth2.client.registration.google.client-secret",
            "SPRING_SECURITY_OAUTH2_CLIENT_REGISTRATION_GOOGLE_REDIRECT_URI" to
                "spring.security.oauth2.client.registration.google.redirect-uri",
        )

    fun load(
        path: Path = Path.of(".env"),
        environment: Map<String, String> = System.getenv(),
        systemProperties: Properties = System.getProperties(),
        announce: (String) -> Unit = System.out::println,
    ) {
        val resolvedPath = path.toAbsolutePath().normalize()
        if (!Files.isRegularFile(path)) {
            announce("No .env file found at $resolvedPath; using process environment and application defaults.")
            return
        }
        val values = parse(path)
        var applied = 0
        var skipped = 0
        values.forEach { (key, value) ->
            if (environment.containsKey(key) || systemProperties.containsKey(key)) {
                skipped++
            } else {
                systemProperties.setProperty(key, value)
                applied++
            }
        }
        systemPropertyAliases.forEach { (environmentName, propertyName) ->
            if (!systemProperties.containsKey(propertyName)) {
                val value = environment[environmentName] ?: systemProperties.getProperty(environmentName)
                if (value != null) systemProperties.setProperty(propertyName, value)
            }
        }
        announce(
            "Loaded .env file $resolvedPath " +
                "($applied settings applied, $skipped overridden by the process environment).",
        )
    }

    private fun parse(path: Path): Map<String, String> {
        val values = linkedMapOf<String, String>()
        Files.readAllLines(path, StandardCharsets.UTF_8).forEachIndexed { index, original ->
            var line = original
            if (index == 0) line = line.removePrefix("\uFEFF")
            line = line.trim()
            if (line.isBlank() || line.startsWith("#")) return@forEachIndexed
            if (line.startsWith("export ")) line = line.removePrefix("export ").trimStart()
            val separator = line.indexOf('=')
            require(separator > 0) { invalidLine(path, index) }
            val key = line.substring(0, separator).trim()
            require(keyPattern.matches(key)) { invalidLine(path, index) }
            values[key] = parseValue(line.substring(separator + 1).trim(), path, index)
        }
        return values
    }

    private fun parseValue(
        raw: String,
        path: Path,
        lineIndex: Int,
    ): String {
        if (raw.isEmpty()) return ""
        if (raw.startsWith("'")) {
            val closing = raw.indexOf('\'', startIndex = 1)
            require(closing >= 0 && validRemainder(raw.substring(closing + 1))) {
                invalidLine(path, lineIndex)
            }
            return raw.substring(1, closing)
        }
        if (raw.startsWith("\"")) {
            val result = StringBuilder()
            var escaped = false
            for (index in 1 until raw.length) {
                val character = raw[index]
                if (escaped) {
                    result.append(
                        when (character) {
                            'n' -> '\n'
                            'r' -> '\r'
                            't' -> '\t'
                            '\\', '"' -> character
                            else -> character
                        },
                    )
                    escaped = false
                } else if (character == '\\') {
                    escaped = true
                } else if (character == '"') {
                    require(validRemainder(raw.substring(index + 1))) { invalidLine(path, lineIndex) }
                    return result.toString()
                } else {
                    result.append(character)
                }
            }
            throw IllegalArgumentException(invalidLine(path, lineIndex))
        }
        val comment =
            raw.indices.firstOrNull { index ->
                raw[index] == '#' && index > 0 && raw[index - 1].isWhitespace()
            }
        return raw.substring(0, comment ?: raw.length).trimEnd()
    }

    private fun validRemainder(value: String): Boolean {
        val remainder = value.trim()
        return remainder.isEmpty() || remainder.startsWith("#")
    }

    private fun invalidLine(
        path: Path,
        lineIndex: Int,
    ) = "Invalid .env entry at ${path.toAbsolutePath().normalize()}:${lineIndex + 1}"
}
