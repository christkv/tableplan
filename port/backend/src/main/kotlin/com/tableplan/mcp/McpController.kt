package com.tableplan.mcp

import com.tableplan.api.ApiException
import com.tableplan.api.principal
import com.tableplan.config.TableplanProperties
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RestController
import tools.jackson.databind.ObjectMapper

private const val MCP_VERSION = "2025-11-25"
private val SUPPORTED_MCP_VERSIONS = setOf("2025-03-26", "2025-06-18", MCP_VERSION)

@RestController
class McpController(
    private val tools: McpToolService,
    private val mapper: ObjectMapper,
    private val properties: TableplanProperties,
) {
    @PostMapping("/mcp", consumes = [MediaType.APPLICATION_JSON_VALUE], produces = [MediaType.APPLICATION_JSON_VALUE])
    fun post(
        @RequestBody request: Map<String, Any?>,
        @RequestHeader(HttpHeaders.ORIGIN, required = false) origin: String?,
        @RequestHeader("MCP-Protocol-Version", required = false) protocolVersion: String?,
        authentication: Authentication,
    ): ResponseEntity<Any> {
        validateOrigin(origin)
        val id = request["id"]
        val method = request["method"] as? String ?: return rpcError(id, -32600, "Invalid request")
        if (method != "initialize" && protocolVersion != null && protocolVersion !in SUPPORTED_MCP_VERSIONS) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(error(id, -32600, "Unsupported MCP protocol version"))
        }
        if (id == null) return ResponseEntity.accepted().build()
        return try {
            val result =
                when (method) {
                    "initialize" ->
                        mapOf(
                            "protocolVersion" to MCP_VERSION,
                            "capabilities" to mapOf("tools" to mapOf("listChanged" to false)),
                            "serverInfo" to mapOf("name" to "tableplan", "version" to "1.0.0"),
                        )
                    "ping" -> emptyMap<String, Any>()
                    "tools/list" -> mapOf("tools" to tools.tools)
                    "tools/call" -> {
                        val params = request["params"] as? Map<*, *> ?: throw McpFailure(-32602, "params are required")
                        val name = params["name"] as? String ?: throw McpFailure(-32602, "tool name is required")
                        @Suppress("UNCHECKED_CAST")
                        val arguments = params["arguments"] as? Map<String, Any?> ?: emptyMap()
                        val value = tools.call(name, arguments, authentication.principal())
                        mapOf(
                            "content" to listOf(mapOf("type" to "text", "text" to mapper.writeValueAsString(value))),
                            "structuredContent" to value,
                            "isError" to false,
                        )
                    }
                    else -> throw McpFailure(-32601, "Method not found")
                }
            ResponseEntity.ok(mapOf("jsonrpc" to "2.0", "id" to id, "result" to result))
        } catch (error: McpFailure) {
            rpcError(id, error.rpcCode, error.message)
        } catch (error: ApiException) {
            ResponseEntity.ok(
                mapOf(
                    "jsonrpc" to "2.0",
                    "id" to id,
                    "result" to
                        mapOf(
                            "content" to listOf(mapOf("type" to "text", "text" to error.message)),
                            "structuredContent" to mapOf("code" to error.code, "message" to error.message),
                            "isError" to true,
                        ),
                ),
            )
        }
    }

    @GetMapping("/mcp")
    fun get(
        @RequestHeader(HttpHeaders.ORIGIN, required = false) origin: String?,
    ): ResponseEntity<Void> {
        validateOrigin(origin)
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED).header(HttpHeaders.ALLOW, "POST").build()
    }

    private fun validateOrigin(origin: String?) {
        if (origin != null && origin.trimEnd('/') != properties.publicOrigin.trimEnd('/')) {
            throw ApiException(403, "origin_denied", "Origin is not allowed.")
        }
    }

    private fun rpcError(id: Any?, code: Int, message: String): ResponseEntity<Any> =
        ResponseEntity.ok(error(id, code, message))

    private fun error(id: Any?, code: Int, message: String) =
        mapOf("jsonrpc" to "2.0", "id" to id, "error" to mapOf("code" to code, "message" to message))
}
