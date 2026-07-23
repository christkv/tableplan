package com.tableplan.api

import com.tableplan.sharing.ShareView
import com.tableplan.sharing.ShoppingShareService
import com.tableplan.shopping.ShoppingList
import com.tableplan.shopping.ShoppingService
import com.tableplan.tenant.PreferencesView
import com.tableplan.tenant.TenantService
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import org.springframework.http.HttpStatus
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

data class GenerateShoppingRequest(
    @field:NotBlank val planId: String,
    val measurementSystem: String = "original",
)

data class ToggleShoppingItemRequest(val checked: Boolean)

data class ShoppingOverview(
    val list: ShoppingList?,
    val preferences: PreferencesView,
    val shares: List<ShareView>,
)

@RestController
class ShoppingController(
    private val shopping: ShoppingService,
    private val tenant: TenantService,
    private val shares: ShoppingShareService,
) {
    @PostMapping("/api/v1/shopping-lists/generate")
    @ResponseStatus(HttpStatus.CREATED)
    fun generate(@Valid @RequestBody request: GenerateShoppingRequest, authentication: Authentication) =
        shopping.generate(authentication.principal(), request.planId, request.measurementSystem)

    @GetMapping("/api/v1/shopping-lists/latest")
    fun latest(authentication: Authentication) = shopping.latest(authentication.principal())

    @GetMapping("/api/v1/shopping-overview")
    fun overview(authentication: Authentication): ShoppingOverview {
        val principal = authentication.principal()
        val list = shopping.latest(principal)
        return ShoppingOverview(
            list = list,
            preferences = tenant.preferences(principal),
            shares = list?.let { shares.list(principal, it.id) }.orEmpty(),
        )
    }

    @GetMapping("/api/v1/shopping-lists/{listId}")
    fun get(@PathVariable listId: String, authentication: Authentication) =
        shopping.getById(authentication.principal(), listId)
            ?: throw ApiException(404, "shopping_list_not_found", "Shopping list not found.")

    @PostMapping("/api/v1/shopping-lists/{listId}/refresh")
    fun refresh(@PathVariable listId: String, authentication: Authentication) =
        shopping.refresh(authentication.principal(), listId)

    @PatchMapping("/api/v1/shopping-items/{itemId}")
    fun toggle(
        @PathVariable itemId: String,
        @RequestBody request: ToggleShoppingItemRequest,
        authentication: Authentication,
    ) = shopping.toggle(authentication.principal(), itemId, request.checked)
}
