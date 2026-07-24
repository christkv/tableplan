package com.tableplan.api

import com.tableplan.tenant.MealSlot
import com.tableplan.tenant.TenantService
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

data class FavouriteRequest(val favourite: Boolean)

data class MeasurementRequest(val measurementSystem: String)

data class AppearanceRequest(val appearance: String)

data class MealSlotsRequest(@field:Size(min = 1, max = 8) val mealSlots: List<MealSlot>)

data class SaveSearchRequest(
    @field:NotBlank @field:Size(max = 80) val name: String,
    val query: String? = null,
    val ingredient: String? = null,
    @field:Size(max = 12) val tags: List<String> = emptyList(),
    val tagMatch: String? = null,
    val scope: String? = null,
)

@RestController
@RequestMapping("/api/v1")
class TenantController(
    private val tenant: TenantService,
) {
    @PutMapping("/recipes/{recipeId}/favourite")
    fun favourite(
        @PathVariable recipeId: String,
        @RequestBody request: FavouriteRequest,
        authentication: Authentication,
    ) = tenant.setFavourite(authentication.principal(), recipeId, request.favourite)

    @GetMapping("/favourites")
    fun favourites(authentication: Authentication) = tenant.listFavourites(authentication.principal())

    @GetMapping("/recipes/{recipeId}/favourite")
    fun favouriteState(@PathVariable recipeId: String, authentication: Authentication) =
        mapOf("favourite" to tenant.isFavourite(authentication.principal(), recipeId))

    @GetMapping("/preferences")
    fun preferences(authentication: Authentication) = tenant.preferences(authentication.principal())

    @PutMapping("/preferences/measurement")
    fun measurement(@RequestBody request: MeasurementRequest, authentication: Authentication) =
        tenant.updateMeasurement(authentication.principal(), request.measurementSystem)

    @PutMapping("/preferences/appearance")
    fun appearance(@RequestBody request: AppearanceRequest, authentication: Authentication) =
        tenant.updateAppearance(authentication.principal(), request.appearance)

    @PutMapping("/preferences/meal-slots")
    fun mealSlots(@Valid @RequestBody request: MealSlotsRequest, authentication: Authentication) =
        tenant.updateSlots(authentication.principal(), request.mealSlots)

    @GetMapping("/saved-searches")
    fun savedSearches(authentication: Authentication) = tenant.listSavedSearches(authentication.principal())

    @PostMapping("/saved-searches")
    fun saveSearch(@Valid @RequestBody request: SaveSearchRequest, authentication: Authentication) =
        tenant.saveSearch(
            authentication.principal(),
            request.name,
            request.query,
            request.ingredient,
            request.tags,
            request.tagMatch,
            request.scope,
        )

    @DeleteMapping("/saved-searches/{id}")
    fun deleteSearch(@PathVariable id: String, authentication: Authentication) =
        tenant.deleteSavedSearch(authentication.principal(), id)

    @GetMapping("/household")
    fun household(authentication: Authentication) = tenant.household(authentication.principal())

    @GetMapping("/households")
    fun households(authentication: Authentication) = tenant.availableHouseholds(authentication.principal())
}
