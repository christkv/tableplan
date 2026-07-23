package com.tableplan.api

import com.tableplan.email.EmailDeliveryService
import org.springframework.http.HttpStatus
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

data class EmailShoppingListRequest(val expiresInDays: Int = 14)

@RestController
class EmailController(
    private val deliveries: EmailDeliveryService,
) {
    @PostMapping("/api/v1/shopping-lists/{listId}/email")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun create(
        @PathVariable listId: String,
        @RequestBody request: EmailShoppingListRequest,
        authentication: Authentication,
    ) = deliveries.create(authentication.principal(), listId, request.expiresInDays)

    @GetMapping("/api/v1/email-deliveries/{id}")
    fun get(@PathVariable id: String, authentication: Authentication) =
        deliveries.get(authentication.principal(), id)
            ?: throw ApiException(404, "email_delivery_not_found", "Email delivery not found.")
}

