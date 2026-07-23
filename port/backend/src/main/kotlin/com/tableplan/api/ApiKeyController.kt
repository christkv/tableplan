package com.tableplan.api

import com.tableplan.auth.ApiKeyService
import com.tableplan.auth.TableplanPrincipal
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.time.Instant

data class CreateApiKeyRequest(
    @field:NotBlank @field:Size(max = 100) val name: String,
    val environment: String,
    @field:Size(min = 1, max = 8) val scopes: List<String>,
    val expiresAt: Instant? = null,
)

@RestController
@RequestMapping("/api/v1/api-keys")
class ApiKeyController(
    private val apiKeys: ApiKeyService,
) {
    @GetMapping
    fun list(authentication: Authentication) = apiKeys.list(authentication.principal())

    @PostMapping
    fun create(@Valid @RequestBody request: CreateApiKeyRequest, authentication: Authentication) =
        apiKeys.create(
            authentication.principal(),
            request.name,
            request.environment,
            request.scopes,
            request.expiresAt,
        )

    @DeleteMapping("/{id}")
    fun revoke(@PathVariable id: String, authentication: Authentication) {
        apiKeys.revoke(authentication.principal(), id)
    }
}

fun Authentication.principal(): TableplanPrincipal =
    principal as? TableplanPrincipal
        ?: throw ApiException(401, "authentication_required", "Authentication is required.")

